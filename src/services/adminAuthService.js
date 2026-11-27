import { randomUUID } from "node:crypto";
import { chmodSync, existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import {
  generateEnrollmentCode,
  generateOpaqueId,
  nowIso,
  sha256Hex
} from "../security/crypto.js";
import { isValidUsername, normalizeUsername } from "../security/validation.js";

const ADMIN_MIN_PASSWORD_LEN = 12;

/**
 * Separate Server Administrator Identity & Secure First-Run Enrollment Service.
 * - Completely separate from Node (`accounts`) identities.
 * - Never ships a hardcoded or default administrator password.
 * - On first run, generates a single-use random enrollment code written with owner-only
 *   permissions (0600) to `${dataDir}/first-run-enrollment.txt`.
 */
export class AdminAuthService {
  constructor({ db, config, passwordHasher, tokenManager, auditService = null }) {
    this.db = db;
    this.config = config;
    this.passwordHasher = passwordHasher;
    this.tokenManager = tokenManager;
    this.auditService = auditService;
    this.enrollmentFilePath = join(this.config.dataDir, "first-run-enrollment.txt");
  }

  hasAdministrators() {
    const row = this.db.prepare("SELECT COUNT(*) AS count FROM admin_accounts").get();
    return (row?.count || 0) > 0;
  }

  /**
   * Ensure a valid one-time first-run enrollment token exists when no administrator has been created yet.
   * Returns metadata only (never logs the plaintext code).
   */
  ensureFirstRunEnrollmentToken() {
    if (this.hasAdministrators()) {
      this._cleanupEnrollmentFile();
      return { initialized: true, enrollmentRequired: false, enrollmentFilePath: null };
    }

    const now = nowIso();
    const active = this.db
      .prepare(
        "SELECT id, expires_at FROM admin_enrollment_tokens WHERE used_at IS NULL AND expires_at > ? ORDER BY created_at DESC LIMIT 1"
      )
      .get(now);

    if (active && existsSync(this.enrollmentFilePath)) {
      return {
        initialized: false,
        enrollmentRequired: true,
        enrollmentFilePath: this.enrollmentFilePath,
        expiresAt: active.expires_at
      };
    }

    const code = generateEnrollmentCode();
    const id = generateOpaqueId("enr");
    const expiresAt = new Date(Date.now() + 30 * 60 * 1000).toISOString();

    this.db
      .prepare(
        "INSERT INTO admin_enrollment_tokens (id, token_hash, created_at, expires_at) VALUES (?, ?, ?, ?)"
      )
      .run(id, sha256Hex(code), now, expiresAt);

    mkdirSync(dirname(this.enrollmentFilePath), { recursive: true, mode: 0o700 });
    const fileBody = [
      "BitVoid Server First-Run Administrator Enrollment",
      "=================================================",
      "This single-use local enrollment code authorizes initial administrator setup",
      "from the BitVoid Desktop Dashboard or local bitvoid-admin CLI.",
      "This file is deleted automatically once setup completes.",
      "",
      `ENROLLMENT_CODE=${code}`,
      `EXPIRES_AT=${expiresAt}`,
      ""
    ].join("\n");

    writeFileSync(this.enrollmentFilePath, fileBody, { encoding: "utf8", mode: 0o600 });
    if (process.platform !== "win32") {
      try {
        chmodSync(this.enrollmentFilePath, 0o600);
      } catch {
        // best effort
      }
    }

    return {
      initialized: false,
      enrollmentRequired: true,
      enrollmentFilePath: this.enrollmentFilePath,
      expiresAt
    };
  }

  _cleanupEnrollmentFile() {
    if (existsSync(this.enrollmentFilePath)) {
      try {
        rmSync(this.enrollmentFilePath, { force: true });
      } catch {
        // ignore
      }
    }
  }

  async completeFirstRunSetup({ enrollmentCode, username, password, clientInfo = "local-ipc" }) {
    if (this.hasAdministrators()) {
      throw new Error("Server administrator setup has already been completed.");
    }
    if (typeof enrollmentCode !== "string" || enrollmentCode.trim().length < 16) {
      throw new Error("A valid first-run enrollment code is required.");
    }
    if (!isValidUsername(username)) {
      throw new Error("Administrator username must be 2-24 characters (letters, numbers, dot, underscore, hyphen).");
    }
    if (typeof password !== "string" || password.length < ADMIN_MIN_PASSWORD_LEN || password.length > 128) {
      throw new Error(`Administrator password must be between ${ADMIN_MIN_PASSWORD_LEN} and 128 characters.`);
    }

    const codeHash = sha256Hex(enrollmentCode.trim().toUpperCase());
    const now = nowIso();
    const tokenRow = this.db
      .prepare(
        "SELECT id, expires_at, used_at FROM admin_enrollment_tokens WHERE token_hash = ?"
      )
      .get(codeHash);

    if (!tokenRow || tokenRow.used_at || Date.parse(tokenRow.expires_at) <= Date.now()) {
      if (this.auditService) {
        this.auditService.record({
          actorType: "admin",
          actorId: null,
          action: "admin.setup",
          outcome: "failure",
          details: { reason: "invalid_or_expired_enrollment_code" }
        });
      }
      throw new Error("First-run enrollment code is invalid or expired.");
    }

    const adminId = generateOpaqueId("adm");
    const normalized = normalizeUsername(username);
    const passwordHash = await this.passwordHasher.hash(password);

    const tx = this.db.transaction(() => {
      this.db
        .prepare("UPDATE admin_enrollment_tokens SET used_at = ? WHERE id = ?")
        .run(now, tokenRow.id);
      this.db
        .prepare(
          `INSERT INTO admin_accounts (
            id, username, password_hash, role, status, created_at, updated_at, last_login_at
          ) VALUES (?, ?, ?, 'owner', 'active', ?, ?, ?)`
        )
        .run(adminId, normalized, passwordHash, now, now, now);
    });
    tx();

    this._cleanupEnrollmentFile();

    const session = this._createAdminSession({
      adminId,
      username: normalized,
      role: "owner",
      clientInfo
    });

    if (this.auditService) {
      this.auditService.record({
        actorType: "admin",
        actorId: adminId,
        action: "admin.setup",
        targetType: "admin_account",
        targetId: adminId,
        outcome: "success",
        details: { username: normalized, role: "owner" }
      });
    }

    return {
      admin: { id: adminId, username: normalized, role: "owner" },
      token: session.token,
      sessionId: session.sessionId,
      expiresAt: session.expiresAt
    };
  }

  _createAdminSession({ adminId, username, role, clientInfo = "local-ipc" }) {
    const sid = randomUUID();
    const signed = this.tokenManager.signAdminToken({
      adminId,
      username,
      role,
      sessionId: sid,
      ttl: "8h"
    });
    const now = nowIso();
    this.db
      .prepare(
        `INSERT INTO admin_sessions (
          id, admin_id, token_hash, client_info, created_at, expires_at, last_used_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        sid,
        adminId,
        sha256Hex(signed.token),
        clientInfo ? String(clientInfo).slice(0, 120) : "local-ipc",
        now,
        signed.expiresAt,
        now
      );

    return { sessionId: sid, token: signed.token, expiresAt: signed.expiresAt };
  }

  async login({ username, password, clientInfo = "local-ipc" }) {
    if (!this.hasAdministrators()) {
      throw new Error("No administrator account exists yet. Complete first-run setup first.");
    }
    if (!isValidUsername(username) || typeof password !== "string" || password.length === 0) {
      throw new Error("Enter a valid administrator username and password.");
    }

    const normalized = normalizeUsername(username);
    const row = this.db
      .prepare("SELECT * FROM admin_accounts WHERE username = ? COLLATE NOCASE")
      .get(normalized);

    if (!row || row.status !== "active") {
      if (this.auditService) {
        this.auditService.record({
          actorType: "admin",
          actorId: null,
          action: "admin.login",
          targetType: "admin_username",
          targetId: normalized,
          outcome: "failure"
        });
      }
      throw new Error("Invalid administrator credentials.");
    }

    const check = await this.passwordHasher.verify(password, row.password_hash);
    if (!check.valid) {
      if (this.auditService) {
        this.auditService.record({
          actorType: "admin",
          actorId: row.id,
          action: "admin.login",
          targetType: "admin_account",
          targetId: row.id,
          outcome: "failure"
        });
      }
      throw new Error("Invalid administrator credentials.");
    }

    const now = nowIso();
    this.db
      .prepare("UPDATE admin_accounts SET last_login_at = ?, updated_at = ? WHERE id = ?")
      .run(now, now, row.id);

    const session = this._createAdminSession({
      adminId: row.id,
      username: row.username,
      role: row.role,
      clientInfo
    });

    if (this.auditService) {
      this.auditService.record({
        actorType: "admin",
        actorId: row.id,
        action: "admin.login",
        targetType: "admin_account",
        targetId: row.id,
        outcome: "success",
        details: { clientInfo }
      });
    }

    return {
      admin: { id: row.id, username: row.username, role: row.role },
      token: session.token,
      sessionId: session.sessionId,
      expiresAt: session.expiresAt
    };
  }

  verifyAdminToken(token) {
    let claims;
    try {
      claims = this.tokenManager.verifyAdminToken(token);
    } catch {
      return { ok: false, message: "Invalid or expired administrator session." };
    }

    const row = this.db
      .prepare(
        `SELECT s.id, s.admin_id, s.expires_at, s.revoked_at,
                a.username, a.role, a.status
         FROM admin_sessions s
         JOIN admin_accounts a ON a.id = s.admin_id
         WHERE s.id = ? AND s.token_hash = ?`
      )
      .get(claims.sid, sha256Hex(token));

    if (!row || row.revoked_at || row.status !== "active" || Date.parse(row.expires_at) <= Date.now()) {
      return { ok: false, message: "Administrator session is revoked or expired." };
    }

    this.db.prepare("UPDATE admin_sessions SET last_used_at = ? WHERE id = ?").run(nowIso(), row.id);
    return {
      ok: true,
      sessionId: row.id,
      admin: { id: row.admin_id, username: row.username, role: row.role }
    };
  }

  listAdminSessions() {
    const now = nowIso();
    return this.db
      .prepare(
        `SELECT s.id, s.admin_id, a.username, a.role, s.client_info,
                s.created_at, s.expires_at, s.last_used_at, s.revoked_at
         FROM admin_sessions s
         JOIN admin_accounts a ON a.id = s.admin_id
         ORDER BY s.created_at DESC
         LIMIT 100`
      )
      .all()
      .map((r) => ({
        id: r.id,
        adminId: r.admin_id,
        username: r.username,
        role: r.role,
        clientInfo: r.client_info,
        status: r.revoked_at ? "revoked" : r.expires_at <= now ? "expired" : "active",
        createdAt: r.created_at,
        expiresAt: r.expires_at,
        lastUsedAt: r.last_used_at,
        revokedAt: r.revoked_at
      }));
  }

  revokeAdminSession(sessionId, actorId = "admin") {
    const res = this.db
      .prepare("UPDATE admin_sessions SET revoked_at = COALESCE(revoked_at, ?) WHERE id = ?")
      .run(nowIso(), sessionId);
    if (res.changes > 0 && this.auditService) {
      this.auditService.record({
        actorType: "admin",
        actorId,
        action: "admin.session.revoke",
        targetType: "admin_session",
        targetId: sessionId,
        outcome: "success"
      });
    }
    return { revoked: res.changes > 0, sessionId };
  }
}
