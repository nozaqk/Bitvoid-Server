import { randomUUID } from "node:crypto";
import { WS_CLOSE_CODES } from "../config/constants.js";
import { generateRefreshToken, nowIso, sha256Hex } from "../security/crypto.js";

function mapSessionRow(row, currentSessionId = null) {
  const nowMs = Date.now();
  const expiresMs = Date.parse(row.expires_at);
  let status = "active";
  if (row.revoked_at) status = "revoked";
  else if (expiresMs <= nowMs) status = "expired";

  return {
    id: row.id,
    nodeId: row.account_id,
    accountId: row.account_id,
    username: row.username || undefined,
    deviceId: row.device_id || null,
    deviceName: row.device_name || null,
    devicePlatform: row.device_platform || null,
    status,
    isCurrent: currentSessionId ? row.id === currentSessionId : undefined,
    createdAt: row.created_at,
    expiresAt: row.expires_at,
    refreshExpiresAt: row.refresh_expires_at || null,
    lastUsedAt: row.last_used_at || null,
    revokedAt: row.revoked_at || null,
    revocationReason: row.revocation_reason || null,
    ipAddress: row.ip_address || null
  };
}

export class SessionService {
  constructor({ db, config, tokenManager, eventHub = null, auditService = null }) {
    this.db = db;
    this.config = config;
    this.tokenManager = tokenManager;
    this.eventHub = eventHub;
    this.auditService = auditService;
  }

  createSession({ account, deviceId = null, ipAddress = null, userAgent = null }) {
    const sid = randomUUID();
    const now = nowIso();
    const signed = this.tokenManager.signAppAccessToken({
      accountId: account.id,
      username: account.username,
      sessionId: sid,
      deviceId,
      ttl: this.config.tokenTtl
    });
    const refreshToken = generateRefreshToken();
    const refreshExpiresAt = new Date(Date.now() + this.config.refreshTtlMs).toISOString();

    this.db
      .prepare(
        `INSERT INTO sessions (
          id, account_id, device_id, token_type, token_hash,
          refresh_token_hash, refresh_expires_at, created_at,
          expires_at, last_used_at, ip_address, user_agent
        ) VALUES (?, ?, ?, 'access', ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        sid,
        account.id,
        deviceId,
        sha256Hex(signed.token),
        sha256Hex(refreshToken),
        refreshExpiresAt,
        now,
        signed.expiresAt,
        now,
        ipAddress,
        userAgent ? String(userAgent).slice(0, 200) : null
      );

    this.db
      .prepare("UPDATE accounts SET last_seen_at = ? WHERE id = ?")
      .run(now, account.id);

    return {
      sessionId: sid,
      token: signed.token,
      expiresAt: signed.expiresAt,
      refreshToken,
      refreshExpiresAt,
      deviceId
    };
  }

  /**
   * Verify a bearer token against JWT signature, DB hash, DB expiry, revocation,
   * device revocation, and Node account status.
   */
  verifyAccessToken(token, { touch = true } = {}) {
    let claims;
    try {
      claims = this.tokenManager.verifyAppAccessToken(token);
    } catch {
      return { ok: false, code: "invalid_token", message: "The account session is invalid or expired." };
    }

    const tokenHash = sha256Hex(token);
    const row = this.db
      .prepare(
        `SELECT s.id, s.account_id, s.device_id, s.expires_at, s.revoked_at,
                a.username, a.display_name, a.status AS account_status,
                d.revoked_at AS device_revoked_at, d.trust_status AS device_trust_status,
                d.display_name AS device_name, d.platform AS device_platform
         FROM sessions s
         JOIN accounts a ON a.id = s.account_id
         LEFT JOIN devices d ON d.id = s.device_id
         WHERE s.id = ? AND s.token_hash = ?`
      )
      .get(claims.sid, tokenHash);

    if (!row || row.revoked_at) {
      return { ok: false, code: "session_revoked", message: "This session is no longer valid." };
    }

    if (Date.parse(row.expires_at) <= Date.now()) {
      return { ok: false, code: "session_expired", message: "This session has expired." };
    }

    if (row.account_status && row.account_status !== "active") {
      return {
        ok: false,
        code: "account_suspended",
        message: "This Node account is suspended or disabled."
      };
    }

    if (row.device_id && (row.device_revoked_at || row.device_trust_status === "revoked")) {
      return {
        ok: false,
        code: "device_revoked",
        message: "This device has been revoked."
      };
    }

    if (touch) {
      const now = nowIso();
      this.db.prepare("UPDATE sessions SET last_used_at = ? WHERE id = ?").run(now, row.id);
      this.db.prepare("UPDATE accounts SET last_seen_at = ? WHERE id = ?").run(now, row.account_id);
      if (row.device_id) {
        this.db.prepare("UPDATE devices SET last_seen_at = ? WHERE id = ?").run(now, row.device_id);
      }
    }

    return {
      ok: true,
      sessionId: row.id,
      expiresAt: row.expires_at,
      account: {
        id: row.account_id,
        nodeId: row.account_id,
        username: row.username,
        displayName: row.display_name || row.username,
        status: row.account_status || "active"
      },
      device: row.device_id
        ? {
            id: row.device_id,
            displayName: row.device_name,
            platform: row.device_platform,
            trustStatus: row.device_trust_status
          }
        : null
    };
  }

  /**
   * Rotate a refresh token into a new access + refresh token pair.
   * Implements refresh-token reuse detection: presenting a revoked refresh token triggers
   * defensive revocation of all active sessions on that device (or account).
   */
  refreshSession({ refreshToken, ipAddress = null, userAgent = null, requestId = null }) {
    if (typeof refreshToken !== "string" || !refreshToken.startsWith("bvr_")) {
      return { ok: false, status: 400, code: "invalid_refresh_token", message: "A valid refresh token is required." };
    }

    const hash = sha256Hex(refreshToken);
    const row = this.db
      .prepare(
        `SELECT s.*, a.username, a.display_name, a.status AS account_status,
                d.revoked_at AS device_revoked_at, d.trust_status AS device_trust_status
         FROM sessions s
         JOIN accounts a ON a.id = s.account_id
         LEFT JOIN devices d ON d.id = s.device_id
         WHERE s.refresh_token_hash = ?`
      )
      .get(hash);

    if (!row) {
      return { ok: false, status: 401, code: "invalid_refresh_token", message: "Refresh token is invalid." };
    }

    // Reuse detection: refresh token already rotated/revoked -> compromise signal!
    if (row.revoked_at) {
      const now = nowIso();
      if (row.device_id) {
        this.db
          .prepare(
            "UPDATE sessions SET revoked_at = COALESCE(revoked_at, ?), revocation_reason = 'refresh_token_reuse_detected' WHERE device_id = ? AND revoked_at IS NULL"
          )
          .run(now, row.device_id);
        if (this.eventHub) {
          this.eventHub.disconnectDevice(row.device_id, WS_CLOSE_CODES.SESSION_REVOKED, "Security revocation");
        }
      } else {
        this.revokeAllSessionsForAccount({
          accountId: row.account_id,
          actorType: "system",
          reason: "refresh_token_reuse_detected"
        });
      }
      if (this.auditService) {
        this.auditService.record({
          actorType: "node",
          actorId: row.account_id,
          action: "security.refresh_token_reuse_detected",
          targetType: "session",
          targetId: row.id,
          outcome: "denied",
          ipAddress,
          requestId,
          details: { deviceId: row.device_id }
        });
      }
      return {
        ok: false,
        status: 401,
        code: "refresh_token_reused",
        message: "Refresh token reuse detected. Active sessions for this device have been revoked."
      };
    }

    if (!row.refresh_expires_at || Date.parse(row.refresh_expires_at) <= Date.now()) {
      return { ok: false, status: 401, code: "refresh_token_expired", message: "Refresh token has expired." };
    }

    if (row.account_status !== "active") {
      return { ok: false, status: 403, code: "account_suspended", message: "This Node account is suspended or disabled." };
    }

    if (row.device_id && (row.device_revoked_at || row.device_trust_status === "revoked")) {
      return { ok: false, status: 401, code: "device_revoked", message: "This device has been revoked." };
    }

    // Revoke old session (rotated) and issue fresh session atomically.
    const now = nowIso();
    let fresh;
    const tx = this.db.transaction(() => {
      this.db
        .prepare("UPDATE sessions SET revoked_at = ?, revocation_reason = 'rotated' WHERE id = ?")
        .run(now, row.id);
      fresh = this.createSession({
        account: { id: row.account_id, username: row.username },
        deviceId: row.device_id,
        ipAddress,
        userAgent
      });
    });
    tx();

    // Close WebSockets bound to the old rotated session ID so clients reconnect with the fresh token.
    if (this.eventHub) {
      this.eventHub.disconnectSession(row.id, WS_CLOSE_CODES.SESSION_REVOKED, "Session rotated");
    }

    if (this.auditService) {
      this.auditService.record({
        actorType: "node",
        actorId: row.account_id,
        action: "auth.refresh",
        targetType: "session",
        targetId: fresh.sessionId,
        outcome: "success",
        ipAddress,
        requestId,
        details: { previousSessionId: row.id, deviceId: row.device_id }
      });
    }

    return {
      ok: true,
      account: {
        id: row.account_id,
        username: row.username,
        displayName: row.display_name || row.username
      },
      session: fresh
    };
  }

  revokeSession({ sessionId, accountId = null, actorType = "node", actorId = null, reason = "revoked", ipAddress = null, requestId = null }) {
    const row = accountId
      ? this.db.prepare("SELECT id, account_id, revoked_at FROM sessions WHERE id = ? AND account_id = ?").get(sessionId, accountId)
      : this.db.prepare("SELECT id, account_id, revoked_at FROM sessions WHERE id = ?").get(sessionId);

    if (!row) return null;

    const now = nowIso();
    if (!row.revoked_at) {
      this.db
        .prepare("UPDATE sessions SET revoked_at = ?, revocation_reason = ? WHERE id = ?")
        .run(now, reason, row.id);
    }

    let disconnectedSockets = 0;
    if (this.eventHub) {
      disconnectedSockets = this.eventHub.disconnectSession(
        row.id,
        WS_CLOSE_CODES.SESSION_REVOKED,
        "Session revoked"
      );
    }

    if (this.auditService) {
      this.auditService.record({
        actorType,
        actorId: actorId || row.account_id,
        action: "session.revoke",
        targetType: "session",
        targetId: row.id,
        outcome: "success",
        ipAddress,
        requestId,
        details: { nodeId: row.account_id, reason, disconnectedSockets }
      });
    }

    return { revoked: true, sessionId: row.id, disconnectedSockets };
  }

  revokeOtherSessions({ accountId, keepSessionId, reason = "revoke_others", ipAddress = null, requestId = null }) {
    const targets = this.db
      .prepare("SELECT id FROM sessions WHERE account_id = ? AND id != ? AND revoked_at IS NULL")
      .all(accountId, keepSessionId);

    const now = nowIso();
    const res = this.db
      .prepare(
        "UPDATE sessions SET revoked_at = ?, revocation_reason = ? WHERE account_id = ? AND id != ? AND revoked_at IS NULL"
      )
      .run(now, reason, accountId, keepSessionId);

    let disconnectedSockets = 0;
    if (this.eventHub) {
      for (const row of targets) {
        disconnectedSockets += this.eventHub.disconnectSession(
          row.id,
          WS_CLOSE_CODES.SESSION_REVOKED,
          "Session revoked"
        );
      }
    }

    if (this.auditService) {
      this.auditService.record({
        actorType: "node",
        actorId: accountId,
        action: "session.revoke_others",
        targetType: "node",
        targetId: accountId,
        outcome: "success",
        ipAddress,
        requestId,
        details: { revokedCount: res.changes, disconnectedSockets, reason }
      });
    }

    return { revokedCount: res.changes, disconnectedSockets };
  }

  revokeAllSessionsForAccount({ accountId, actorType = "system", actorId = null, reason = "revoke_all", ipAddress = null, requestId = null }) {
    const now = nowIso();
    const res = this.db
      .prepare(
        "UPDATE sessions SET revoked_at = ?, revocation_reason = ? WHERE account_id = ? AND revoked_at IS NULL"
      )
      .run(now, reason, accountId);

    let disconnectedSockets = 0;
    if (this.eventHub) {
      disconnectedSockets = this.eventHub.disconnectAccount(
        accountId,
        WS_CLOSE_CODES.SESSION_REVOKED,
        "All sessions revoked"
      );
    }

    if (this.auditService) {
      this.auditService.record({
        actorType,
        actorId: actorId || accountId,
        action: "session.revoke_all",
        targetType: "node",
        targetId: accountId,
        outcome: "success",
        ipAddress,
        requestId,
        details: { revokedCount: res.changes, disconnectedSockets, reason }
      });
    }

    return { revokedCount: res.changes, disconnectedSockets };
  }

  listSessionsForAccount(accountId, currentSessionId = null) {
    const rows = this.db
      .prepare(
        `SELECT s.*, d.display_name AS device_name, d.platform AS device_platform
         FROM sessions s
         LEFT JOIN devices d ON d.id = s.device_id
         WHERE s.account_id = ?
         ORDER BY s.created_at DESC`
      )
      .all(accountId);
    return rows.map((row) => mapSessionRow(row, currentSessionId));
  }

  listAllSessions({ accountId = null, status = "all", limit = 200 } = {}) {
    const now = nowIso();
    const clauses = [];
    const params = [];

    if (accountId) {
      clauses.push("s.account_id = ?");
      params.push(accountId);
    }
    if (status === "active") {
      clauses.push("s.revoked_at IS NULL AND s.expires_at > ?");
      params.push(now);
    } else if (status === "expired") {
      clauses.push("s.revoked_at IS NULL AND s.expires_at <= ?");
      params.push(now);
    } else if (status === "revoked") {
      clauses.push("s.revoked_at IS NOT NULL");
    }

    const whereSql = clauses.length > 0 ? `WHERE ${clauses.join(" AND ")}` : "";
    const rows = this.db
      .prepare(
        `SELECT s.*, a.username, d.display_name AS device_name, d.platform AS device_platform
         FROM sessions s
         JOIN accounts a ON a.id = s.account_id
         LEFT JOIN devices d ON d.id = s.device_id
         ${whereSql}
         ORDER BY s.created_at DESC
         LIMIT ?`
      )
      .all(...params, Math.min(Math.max(Number(limit) || 200, 1), 1000));

    return rows.map((row) => mapSessionRow(row));
  }

  /**
   * Purge expired/revoked sessions older than retentionDays (default 30 days) and
   * disconnect any open WebSockets whose session expired.
   */
  cleanupExpiredSessions({ retentionDays = 30 } = {}) {
    const cutoff = new Date(Date.now() - retentionDays * 24 * 60 * 60 * 1000).toISOString();
    const res = this.db
      .prepare(
        `DELETE FROM sessions
         WHERE (revoked_at IS NOT NULL AND revoked_at < ?)
            OR (expires_at < ? AND (refresh_expires_at IS NULL OR refresh_expires_at < ?))`
      )
      .run(cutoff, cutoff, cutoff);

    const closedSockets = this.eventHub ? this.eventHub.disconnectExpiredSessions() : 0;
    return { deletedRows: res.changes, closedExpiredSockets: closedSockets };
  }
}
