import {
  generateOpaqueId,
  generateRecoveryKeyHex,
  nowIso,
  sha256Hex
} from "../security/crypto.js";
import {
  isValidDisplayName,
  isValidPassword,
  isValidRecoveryKey,
  isValidUsername,
  normalizeUsername
} from "../security/validation.js";

export class AuthService {
  constructor({
    db,
    passwordHasher,
    deviceService,
    sessionService,
    nodeService,
    auditService,
    loginRateLimiter,
    recoveryRateLimiter
  }) {
    this.db = db;
    this.passwordHasher = passwordHasher;
    this.deviceService = deviceService;
    this.sessionService = sessionService;
    this.nodeService = nodeService;
    this.auditService = auditService;
    this.loginRateLimiter = loginRateLimiter;
    this.recoveryRateLimiter = recoveryRateLimiter;
  }

  async register({
    username,
    password,
    displayName = null,
    device = null,
    ipAddress = null,
    userAgent = null,
    requestId = null
  }) {
    if (!isValidUsername(username)) {
      return {
        ok: false,
        status: 400,
        code: "validation_error",
        message: "Username must be 2-24 characters using letters, numbers, dot, underscore or hyphen."
      };
    }
    if (!isValidPassword(password)) {
      return {
        ok: false,
        status: 400,
        code: "validation_error",
        message: "Password must contain 10-128 characters."
      };
    }
    if (displayName !== null && displayName !== undefined && !isValidDisplayName(displayName)) {
      return {
        ok: false,
        status: 400,
        code: "validation_error",
        message: "Display name must be 1-64 characters."
      };
    }

    const normalized = normalizeUsername(username);
    const existing = this.db
      .prepare("SELECT id FROM accounts WHERE username = ? COLLATE NOCASE")
      .get(normalized);
    if (existing) {
      return {
        ok: false,
        status: 409,
        code: "username_taken",
        message: "That username is already registered."
      };
    }

    const id = generateOpaqueId("usr");
    const masterPassphrase = generateRecoveryKeyHex();
    const passwordHash = await this.passwordHasher.hash(password);
    const now = nowIso();
    const finalDisplayName = displayName ? displayName.trim() : normalized;

    try {
      this.db
        .prepare(
          `INSERT INTO accounts (
            id, username, display_name, status, password_hash, password_algo,
            recovery_hash, created_at, updated_at, last_seen_at
          ) VALUES (?, ?, ?, 'active', ?, 'argon2id', ?, ?, ?, ?)`
        )
        .run(
          id,
          normalized,
          finalDisplayName,
          passwordHash,
          sha256Hex(masterPassphrase),
          now,
          now,
          now
        );
    } catch (err) {
      if (err.code === "SQLITE_CONSTRAINT_UNIQUE") {
        return {
          ok: false,
          status: 409,
          code: "username_taken",
          message: "That username is already registered."
        };
      }
      throw err;
    }

    const enrolledDevice = this.deviceService.registerOrTouchDevice({
      accountId: id,
      displayName: device?.displayName || device?.deviceName || "Primary Device",
      platform: device?.platform || "unknown",
      appVersion: device?.appVersion || null,
      deviceFingerprint: device?.deviceFingerprint || device?.fingerprint || null,
      publicKey: device?.publicKey || null
    });

    const account = { id, username: normalized };
    const session = this.sessionService.createSession({
      account,
      deviceId: enrolledDevice.id,
      ipAddress,
      userAgent
    });

    this.auditService.record({
      actorType: "node",
      actorId: id,
      action: "account.register",
      targetType: "node",
      targetId: id,
      outcome: "success",
      ipAddress,
      requestId,
      details: { username: normalized, deviceId: enrolledDevice.id, passwordAlgo: "argon2id" }
    });

    return {
      ok: true,
      status: 201,
      payload: {
        account: { id, username: normalized, displayName: finalDisplayName },
        node: this.nodeService.getNodeById(id),
        device: enrolledDevice,
        token: session.token,
        refreshToken: session.refreshToken,
        expiresAt: session.expiresAt,
        refreshExpiresAt: session.refreshExpiresAt,
        masterPassphrase
      }
    };
  }

  async login({
    username,
    password,
    device = null,
    ipAddress = null,
    userAgent = null,
    requestId = null
  }) {
    if (!isValidUsername(username) || typeof password !== "string" || password.length === 0) {
      return {
        ok: false,
        status: 400,
        code: "validation_error",
        message: "Enter a valid username and password."
      };
    }

    const normalized = normalizeUsername(username);
    const rateKey = `login:${normalized}`;
    const rateCheck = this.loginRateLimiter.check(rateKey);
    if (!rateCheck.allowed) {
      this.auditService.record({
        actorType: "node",
        actorId: null,
        action: "auth.login.rate_limited",
        targetType: "username",
        targetId: normalized,
        outcome: "denied",
        ipAddress,
        requestId,
        details: { retryAfterMs: rateCheck.retryAfterMs }
      });
      return {
        ok: false,
        status: 429,
        code: "rate_limited",
        message: "Too many failed login attempts for this account. Please wait before trying again.",
        retryAfterSeconds: Math.ceil(rateCheck.retryAfterMs / 1000)
      };
    }

    const row = this.db
      .prepare(
        "SELECT id, username, display_name, status, password_hash, password_algo FROM accounts WHERE username = ? COLLATE NOCASE"
      )
      .get(normalized);

    if (!row) {
      this.loginRateLimiter.recordFailure(rateKey);
      this.auditService.record({
        actorType: "node",
        actorId: null,
        action: "auth.login",
        targetType: "username",
        targetId: normalized,
        outcome: "failure",
        ipAddress,
        requestId,
        details: { reason: "unknown_account" }
      });
      return {
        ok: false,
        status: 401,
        code: "invalid_credentials",
        message: "Username or password is incorrect."
      };
    }

    const verification = await this.passwordHasher.verify(password, row.password_hash);
    if (!verification.valid) {
      const failState = this.loginRateLimiter.recordFailure(rateKey);
      this.auditService.record({
        actorType: "node",
        actorId: row.id,
        action: "auth.login",
        targetType: "node",
        targetId: row.id,
        outcome: "failure",
        ipAddress,
        requestId,
        details: { reason: "bad_password", locked: failState.locked }
      });
      return {
        ok: false,
        status: 401,
        code: "invalid_credentials",
        message: "Username or password is incorrect."
      };
    }

    if (row.status && row.status !== "active") {
      this.auditService.record({
        actorType: "node",
        actorId: row.id,
        action: "auth.login",
        targetType: "node",
        targetId: row.id,
        outcome: "denied",
        ipAddress,
        requestId,
        details: { reason: `account_${row.status}` }
      });
      return {
        ok: false,
        status: 403,
        code: "account_suspended",
        message: "This Node account is suspended or disabled."
      };
    }

    this.loginRateLimiter.recordSuccess(rateKey);

    // Transparent upgrade from legacy bcrypt (or outdated Argon2id cost) to current Argon2id.
    let rehashed = false;
    if (verification.needsRehash) {
      const upgradedHash = await this.passwordHasher.hash(password);
      this.db
        .prepare(
          "UPDATE accounts SET password_hash = ?, password_algo = 'argon2id', updated_at = ? WHERE id = ?"
        )
        .run(upgradedHash, nowIso(), row.id);
      rehashed = true;
    }

    const enrolledDevice = this.deviceService.registerOrTouchDevice({
      accountId: row.id,
      deviceId: device?.deviceId || device?.id || null,
      displayName: device?.displayName || device?.deviceName || "BitVoid Client",
      platform: device?.platform || "unknown",
      appVersion: device?.appVersion || null,
      deviceFingerprint: device?.deviceFingerprint || device?.fingerprint || null,
      publicKey: device?.publicKey || null
    });

    const account = { id: row.id, username: row.username };
    const session = this.sessionService.createSession({
      account,
      deviceId: enrolledDevice.id,
      ipAddress,
      userAgent
    });

    this.auditService.record({
      actorType: "node",
      actorId: row.id,
      action: "auth.login",
      targetType: "node",
      targetId: row.id,
      outcome: "success",
      ipAddress,
      requestId,
      details: {
        deviceId: enrolledDevice.id,
        previousAlgo: verification.algorithm,
        upgradedToArgon2id: rehashed
      }
    });

    return {
      ok: true,
      status: 200,
      payload: {
        account: {
          id: row.id,
          username: row.username,
          displayName: row.display_name || row.username
        },
        node: this.nodeService.getNodeById(row.id),
        device: enrolledDevice,
        token: session.token,
        refreshToken: session.refreshToken,
        expiresAt: session.expiresAt,
        refreshExpiresAt: session.refreshExpiresAt
      }
    };
  }

  async recover({
    masterPassphrase,
    newPassword,
    rotateRecoveryKey = false,
    device = null,
    ipAddress = null,
    userAgent = null,
    requestId = null
  }) {
    if (!isValidRecoveryKey(masterPassphrase) || !isValidPassword(newPassword)) {
      return {
        ok: false,
        status: 400,
        code: "validation_error",
        message: "A valid 44-character recovery key and a 10-128 character new password are required."
      };
    }

    const rateKey = `recover:global`;
    const rateCheck = this.recoveryRateLimiter.check(rateKey);
    if (!rateCheck.allowed) {
      this.auditService.record({
        actorType: "node",
        actorId: null,
        action: "account.recover.rate_limited",
        outcome: "denied",
        ipAddress,
        requestId
      });
      return {
        ok: false,
        status: 429,
        code: "rate_limited",
        message: "Too many failed recovery attempts. Please wait before trying again.",
        retryAfterSeconds: Math.ceil(rateCheck.retryAfterMs / 1000)
      };
    }

    // Normalize hex case so uppercase/lowercase hex both verify identically to v1.
    const normalizedKey = masterPassphrase.toLowerCase();
    const match = this.db
      .prepare("SELECT id, username, display_name, status FROM accounts WHERE recovery_hash = ?")
      .get(sha256Hex(normalizedKey));

    if (!match) {
      this.recoveryRateLimiter.recordFailure(rateKey);
      this.auditService.record({
        actorType: "node",
        actorId: null,
        action: "account.recover",
        outcome: "failure",
        ipAddress,
        requestId,
        details: { reason: "invalid_recovery_key" }
      });
      return {
        ok: false,
        status: 401,
        code: "invalid_recovery_key",
        message: "The recovery key is not valid."
      };
    }

    if (match.status && match.status !== "active") {
      return {
        ok: false,
        status: 403,
        code: "account_suspended",
        message: "This Node account is suspended or disabled."
      };
    }

    this.recoveryRateLimiter.recordSuccess(rateKey);
    const newHash = await this.passwordHasher.hash(newPassword);
    const now = nowIso();

    let nextMasterPassphrase = null;
    if (rotateRecoveryKey) {
      nextMasterPassphrase = generateRecoveryKeyHex();
      this.db
        .prepare(
          `UPDATE accounts
           SET password_hash = ?, password_algo = 'argon2id', recovery_hash = ?,
               recovery_key_rotated_at = ?, updated_at = ?
           WHERE id = ?`
        )
        .run(newHash, sha256Hex(nextMasterPassphrase), now, now, match.id);
    } else {
      this.db
        .prepare(
          `UPDATE accounts
           SET password_hash = ?, password_algo = 'argon2id', updated_at = ?
           WHERE id = ?`
        )
        .run(newHash, now, match.id);
    }

    // Revoke ALL existing sessions AND close ALL active WebSockets for this Node.
    const revokedInfo = this.sessionService.revokeAllSessionsForAccount({
      accountId: match.id,
      actorType: "node",
      actorId: match.id,
      reason: "account_recovered",
      ipAddress,
      requestId
    });

    const enrolledDevice = this.deviceService.registerOrTouchDevice({
      accountId: match.id,
      displayName: device?.displayName || device?.deviceName || "Recovered Device",
      platform: device?.platform || "unknown",
      appVersion: device?.appVersion || null,
      deviceFingerprint: device?.deviceFingerprint || device?.fingerprint || null
    });

    const account = { id: match.id, username: match.username };
    const session = this.sessionService.createSession({
      account,
      deviceId: enrolledDevice.id,
      ipAddress,
      userAgent
    });

    this.auditService.record({
      actorType: "node",
      actorId: match.id,
      action: "account.recover",
      targetType: "node",
      targetId: match.id,
      outcome: "success",
      ipAddress,
      requestId,
      details: {
        revokedSessions: revokedInfo.revokedCount,
        disconnectedSockets: revokedInfo.disconnectedSockets,
        recoveryKeyRotated: Boolean(rotateRecoveryKey)
      }
    });

    const payload = {
      account: {
        id: match.id,
        username: match.username,
        displayName: match.display_name || match.username
      },
      node: this.nodeService.getNodeById(match.id),
      device: enrolledDevice,
      token: session.token,
      refreshToken: session.refreshToken,
      expiresAt: session.expiresAt,
      refreshExpiresAt: session.refreshExpiresAt
    };
    if (nextMasterPassphrase) {
      payload.masterPassphrase = nextMasterPassphrase;
    }

    return { ok: true, status: 200, payload };
  }

  async changePassword({
    accountId,
    currentSessionId,
    currentPassword,
    newPassword,
    ipAddress = null,
    requestId = null
  }) {
    if (typeof currentPassword !== "string" || !isValidPassword(newPassword)) {
      return {
        ok: false,
        status: 400,
        code: "validation_error",
        message: "Current password and a 10-128 character new password are required."
      };
    }

    const row = this.db
      .prepare("SELECT id, password_hash FROM accounts WHERE id = ?")
      .get(accountId);
    if (!row) {
      return { ok: false, status: 404, code: "not_found", message: "Account not found." };
    }

    const check = await this.passwordHasher.verify(currentPassword, row.password_hash);
    if (!check.valid) {
      this.auditService.record({
        actorType: "node",
        actorId: accountId,
        action: "account.password_change",
        targetType: "node",
        targetId: accountId,
        outcome: "failure",
        ipAddress,
        requestId,
        details: { reason: "invalid_current_password" }
      });
      return {
        ok: false,
        status: 401,
        code: "invalid_credentials",
        message: "Current password is incorrect."
      };
    }

    const newHash = await this.passwordHasher.hash(newPassword);
    this.db
      .prepare(
        "UPDATE accounts SET password_hash = ?, password_algo = 'argon2id', updated_at = ? WHERE id = ?"
      )
      .run(newHash, nowIso(), accountId);

    const revoked = this.sessionService.revokeOtherSessions({
      accountId,
      keepSessionId: currentSessionId,
      reason: "password_changed",
      ipAddress,
      requestId
    });

    this.auditService.record({
      actorType: "node",
      actorId: accountId,
      action: "account.password_change",
      targetType: "node",
      targetId: accountId,
      outcome: "success",
      ipAddress,
      requestId,
      details: { revokedOtherSessions: revoked.revokedCount }
    });

    return {
      ok: true,
      status: 200,
      payload: {
        passwordChanged: true,
        revokedOtherSessions: revoked.revokedCount
      }
    };
  }

  async rotateRecoveryKey({ accountId, currentPassword, ipAddress = null, requestId = null }) {
    if (typeof currentPassword !== "string" || currentPassword.length === 0) {
      return {
        ok: false,
        status: 400,
        code: "validation_error",
        message: "Current password is required to rotate the recovery key."
      };
    }

    const row = this.db
      .prepare("SELECT id, password_hash FROM accounts WHERE id = ?")
      .get(accountId);
    if (!row) {
      return { ok: false, status: 404, code: "not_found", message: "Account not found." };
    }

    const check = await this.passwordHasher.verify(currentPassword, row.password_hash);
    if (!check.valid) {
      this.auditService.record({
        actorType: "node",
        actorId: accountId,
        action: "account.recovery_key_rotate",
        targetType: "node",
        targetId: accountId,
        outcome: "failure",
        ipAddress,
        requestId
      });
      return {
        ok: false,
        status: 401,
        code: "invalid_credentials",
        message: "Current password is incorrect."
      };
    }

    const masterPassphrase = generateRecoveryKeyHex();
    const now = nowIso();
    this.db
      .prepare(
        "UPDATE accounts SET recovery_hash = ?, recovery_key_rotated_at = ?, updated_at = ? WHERE id = ?"
      )
      .run(sha256Hex(masterPassphrase), now, now, accountId);

    this.auditService.record({
      actorType: "node",
      actorId: accountId,
      action: "account.recovery_key_rotate",
      targetType: "node",
      targetId: accountId,
      outcome: "success",
      ipAddress,
      requestId
    });

    return {
      ok: true,
      status: 200,
      payload: {
        masterPassphrase,
        rotatedAt: now
      }
    };
  }
}
