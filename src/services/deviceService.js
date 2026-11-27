import { WS_CLOSE_CODES } from "../config/constants.js";
import { generateOpaqueId, nowIso } from "../security/crypto.js";
import {
  isValidDeviceTrustStatus,
  normalizeDevicePlatform,
  sanitizeDeviceName
} from "../security/validation.js";

function mapDeviceRow(row) {
  if (!row) return null;
  return {
    id: row.id,
    nodeId: row.account_id,
    accountId: row.account_id,
    displayName: row.display_name,
    platform: row.platform,
    appVersion: row.app_version,
    deviceFingerprint: row.device_fingerprint,
    trustStatus: row.trust_status,
    createdAt: row.created_at,
    lastSeenAt: row.last_seen_at,
    revokedAt: row.revoked_at
  };
}

export class DeviceService {
  constructor({ db, eventHub = null, auditService = null }) {
    this.db = db;
    this.eventHub = eventHub;
    this.auditService = auditService;
  }

  /**
   * Register a new device for a Node or refresh an existing matching device (by fingerprint or ID).
   */
  registerOrTouchDevice({
    accountId,
    deviceId = null,
    displayName = "BitVoid Client",
    platform = "unknown",
    appVersion = null,
    deviceFingerprint = null,
    publicKey = null
  }) {
    const now = nowIso();
    const safeName = sanitizeDeviceName(displayName, "BitVoid Client");
    const safePlatform = normalizeDevicePlatform(platform);
    const safeAppVersion =
      typeof appVersion === "string" && appVersion.trim() ? appVersion.trim().slice(0, 40) : null;
    const safeFingerprint =
      typeof deviceFingerprint === "string" && deviceFingerprint.trim()
        ? deviceFingerprint.trim().slice(0, 128)
        : null;
    const safePublicKey =
      typeof publicKey === "string" && publicKey.trim() ? publicKey.trim().slice(0, 2048) : null;

    let existing = null;
    if (deviceId) {
      existing = this.db
        .prepare("SELECT * FROM devices WHERE id = ? AND account_id = ?")
        .get(deviceId, accountId);
    } else if (safeFingerprint) {
      existing = this.db
        .prepare(
          "SELECT * FROM devices WHERE account_id = ? AND device_fingerprint = ? AND revoked_at IS NULL"
        )
        .get(accountId, safeFingerprint);
    }

    if (existing) {
      if (existing.revoked_at || existing.trust_status === "revoked") {
        // Never silently resurrect a revoked device; enroll a fresh device ID instead.
        existing = null;
      } else {
        this.db
          .prepare(
            `UPDATE devices
             SET display_name = ?, platform = ?, app_version = COALESCE(?, app_version),
                 public_key = COALESCE(?, public_key), last_seen_at = ?
             WHERE id = ?`
          )
          .run(safeName, safePlatform, safeAppVersion, safePublicKey, now, existing.id);
        return this.getDevice(existing.id);
      }
    }

    const id = generateOpaqueId("dev");
    this.db
      .prepare(
        `INSERT INTO devices (
          id, account_id, display_name, platform, app_version,
          device_fingerprint, public_key, trust_status, created_at, last_seen_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, 'trusted', ?, ?)`
      )
      .run(
        id,
        accountId,
        safeName,
        safePlatform,
        safeAppVersion,
        safeFingerprint,
        safePublicKey,
        now,
        now
      );

    return this.getDevice(id);
  }

  getDevice(deviceId) {
    const row = this.db.prepare("SELECT * FROM devices WHERE id = ?").get(deviceId);
    return mapDeviceRow(row);
  }

  touchDevice(deviceId) {
    if (!deviceId) return;
    this.db.prepare("UPDATE devices SET last_seen_at = ? WHERE id = ?").run(nowIso(), deviceId);
  }

  listDevicesForAccount(accountId) {
    const now = nowIso();
    const rows = this.db
      .prepare(
        `SELECT d.*,
                (SELECT COUNT(*) FROM sessions s
                 WHERE s.device_id = d.id AND s.revoked_at IS NULL AND s.expires_at > ?) AS active_sessions
         FROM devices d
         WHERE d.account_id = ?
         ORDER BY d.last_seen_at DESC`
      )
      .all(now, accountId);

    return rows.map((row) => ({
      ...mapDeviceRow(row),
      activeSessions: row.active_sessions || 0
    }));
  }

  listAllDevices({ accountId = null, includeRevoked = true } = {}) {
    const now = nowIso();
    const clauses = [];
    const params = [now];
    if (accountId) {
      clauses.push("d.account_id = ?");
      params.push(accountId);
    }
    if (!includeRevoked) {
      clauses.push("d.revoked_at IS NULL");
    }
    const whereSql = clauses.length > 0 ? `WHERE ${clauses.join(" AND ")}` : "";
    const rows = this.db
      .prepare(
        `SELECT d.*, a.username,
                (SELECT COUNT(*) FROM sessions s
                 WHERE s.device_id = d.id AND s.revoked_at IS NULL AND s.expires_at > ?) AS active_sessions
         FROM devices d
         JOIN accounts a ON a.id = d.account_id
         ${whereSql}
         ORDER BY d.last_seen_at DESC`
      )
      .all(...params);

    return rows.map((row) => ({
      ...mapDeviceRow(row),
      username: row.username,
      activeSessions: row.active_sessions || 0
    }));
  }

  updateDevice({ deviceId, accountId = null, displayName, trustStatus, actorType = "node", actorId = null }) {
    const row = accountId
      ? this.db.prepare("SELECT * FROM devices WHERE id = ? AND account_id = ?").get(deviceId, accountId)
      : this.db.prepare("SELECT * FROM devices WHERE id = ?").get(deviceId);
    if (!row) return null;

    const updates = [];
    const params = [];

    if (displayName !== undefined) {
      updates.push("display_name = ?");
      params.push(sanitizeDeviceName(displayName, row.display_name));
    }

    if (trustStatus !== undefined) {
      if (!isValidDeviceTrustStatus(trustStatus)) {
        throw new Error(`Invalid device trust status: ${trustStatus}`);
      }
      if (trustStatus === "revoked") {
        return this.revokeDevice({ deviceId: row.id, accountId: row.account_id, actorType, actorId, reason: "trust_revoked" });
      }
      updates.push("trust_status = ?");
      params.push(trustStatus);
    }

    if (updates.length > 0) {
      params.push(row.id);
      this.db.prepare(`UPDATE devices SET ${updates.join(", ")} WHERE id = ?`).run(...params);
    }

    if (this.auditService) {
      this.auditService.record({
        actorType,
        actorId: actorId || row.account_id,
        action: "device.update",
        targetType: "device",
        targetId: row.id,
        outcome: "success",
        details: { displayName, trustStatus }
      });
    }

    return this.getDevice(row.id);
  }

  revokeDevice({ deviceId, accountId = null, actorType = "node", actorId = null, reason = "revoked" }) {
    const row = accountId
      ? this.db.prepare("SELECT * FROM devices WHERE id = ? AND account_id = ?").get(deviceId, accountId)
      : this.db.prepare("SELECT * FROM devices WHERE id = ?").get(deviceId);
    if (!row) return null;

    const now = nowIso();
    const tx = this.db.transaction(() => {
      this.db
        .prepare("UPDATE devices SET trust_status = 'revoked', revoked_at = COALESCE(revoked_at, ?) WHERE id = ?")
        .run(now, row.id);
      this.db
        .prepare(
          "UPDATE sessions SET revoked_at = COALESCE(revoked_at, ?), revocation_reason = COALESCE(revocation_reason, ?) WHERE device_id = ? AND revoked_at IS NULL"
        )
        .run(now, reason, row.id);
    });
    tx();

    // Immediately terminate all live WebSocket connections belonging to this device.
    let disconnectedSockets = 0;
    if (this.eventHub) {
      disconnectedSockets = this.eventHub.disconnectDevice(
        row.id,
        WS_CLOSE_CODES.DEVICE_REVOKED,
        "Device revoked"
      );
    }

    if (this.auditService) {
      this.auditService.record({
        actorType,
        actorId: actorId || row.account_id,
        action: "device.revoke",
        targetType: "device",
        targetId: row.id,
        outcome: "success",
        details: { nodeId: row.account_id, reason, disconnectedSockets }
      });
    }

    return {
      ...this.getDevice(row.id),
      disconnectedSockets
    };
  }
}
