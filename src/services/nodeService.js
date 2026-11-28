import { WS_CLOSE_CODES } from "../config/constants.js";
import { nowIso } from "../security/crypto.js";
import { isValidDisplayName, isValidNodeStatus } from "../security/validation.js";

/**
 * Node Management Service.
 * Every registered account in AirMesh is a Node (preserving `accounts.id` as the stable Node ID).
 */
export class NodeService {
  constructor({ db, eventHub = null, metricsService = null, sessionService = null, auditService = null }) {
    this.db = db;
    this.eventHub = eventHub;
    this.metricsService = metricsService;
    this.sessionService = sessionService;
    this.auditService = auditService;
  }

  getNodeById(nodeId) {
    const now = nowIso();
    const row = this.db
      .prepare(
        `SELECT a.id, a.username, a.display_name, a.status, a.password_algo,
                a.created_at, a.updated_at, a.last_seen_at, a.recovery_key_rotated_at,
                (SELECT COUNT(*) FROM devices d WHERE d.account_id = a.id AND d.revoked_at IS NULL) AS active_devices,
                (SELECT COUNT(*) FROM sessions s WHERE s.account_id = a.id AND s.revoked_at IS NULL AND s.expires_at > ?) AS active_sessions
         FROM accounts a
         WHERE a.id = ?`
      )
      .get(now, nodeId);

    if (!row) return null;

    const online = this.eventHub ? this.eventHub.isAccountOnline(row.id) : false;
    const traffic = this.metricsService ? this.metricsService.getNodeTraffic(row.id) : null;

    return {
      id: row.id,
      nodeId: row.id,
      username: row.username,
      displayName: row.display_name || row.username,
      status: row.status || "active",
      passwordAlgorithm: row.password_algo || "bcrypt",
      online,
      activeDevices: row.active_devices || 0,
      activeSessions: row.active_sessions || 0,
      createdAt: row.created_at,
      updatedAt: row.updated_at || row.created_at,
      lastSeenAt: row.last_seen_at || null,
      recoveryKeyRotatedAt: row.recovery_key_rotated_at || null,
      traffic
    };
  }

  getNodeByUsername(username) {
    const row = this.db
      .prepare("SELECT id FROM accounts WHERE username = ? COLLATE NOCASE")
      .get(username);
    return row ? this.getNodeById(row.id) : null;
  }

  listNodes({ search = "", status = null, limit = 100, offset = 0 } = {}) {
    if (this.metricsService) {
      this.metricsService.flushTrafficToDb();
    }
    const now = nowIso();
    const clauses = [];
    const params = [now];

    if (search && search.trim()) {
      clauses.push("(a.username LIKE ? OR a.display_name LIKE ? OR a.id LIKE ?)");
      const pattern = `%${search.trim()}%`;
      params.push(pattern, pattern, pattern);
    }
    if (status && isValidNodeStatus(status)) {
      clauses.push("a.status = ?");
      params.push(status);
    }

    const whereSql = clauses.length > 0 ? `WHERE ${clauses.join(" AND ")}` : "";
    const safeLimit = Math.min(Math.max(Number(limit) || 100, 1), 500);
    const safeOffset = Math.max(Number(offset) || 0, 0);

    const rows = this.db
      .prepare(
        `SELECT a.id, a.username, a.display_name, a.status, a.password_algo,
                a.created_at, a.updated_at, a.last_seen_at, a.recovery_key_rotated_at,
                (SELECT COUNT(*) FROM devices d WHERE d.account_id = a.id AND d.revoked_at IS NULL) AS active_devices,
                (SELECT COUNT(*) FROM sessions s WHERE s.account_id = a.id AND s.revoked_at IS NULL AND s.expires_at > ?) AS active_sessions,
                COALESCE(t.http_rx_bytes, 0) AS http_rx_bytes,
                COALESCE(t.http_tx_bytes, 0) AS http_tx_bytes,
                COALESCE(t.ws_rx_bytes, 0) AS ws_rx_bytes,
                COALESCE(t.ws_tx_bytes, 0) AS ws_tx_bytes,
                COALESCE(t.request_count, 0) AS request_count,
                COALESCE(t.ws_message_count, 0) AS ws_message_count
         FROM accounts a
         LEFT JOIN node_traffic_stats t ON t.account_id = a.id
         ${whereSql}
         ORDER BY a.created_at DESC
         LIMIT ? OFFSET ?`
      )
      .all(...params, safeLimit, safeOffset);

    const onlineSet = new Set(this.eventHub ? this.eventHub.getOnlineAccountIds() : []);

    return rows.map((row) => ({
      id: row.id,
      nodeId: row.id,
      username: row.username,
      displayName: row.display_name || row.username,
      status: row.status || "active",
      passwordAlgorithm: row.password_algo || "bcrypt",
      online: onlineSet.has(row.id),
      activeDevices: row.active_devices || 0,
      activeSessions: row.active_sessions || 0,
      createdAt: row.created_at,
      updatedAt: row.updated_at || row.created_at,
      lastSeenAt: row.last_seen_at || null,
      recoveryKeyRotatedAt: row.recovery_key_rotated_at || null,
      traffic: {
        httpRxBytes: row.http_rx_bytes,
        httpTxBytes: row.http_tx_bytes,
        wsRxBytes: row.ws_rx_bytes,
        wsTxBytes: row.ws_tx_bytes,
        totalRxBytes: row.http_rx_bytes + row.ws_rx_bytes,
        totalTxBytes: row.http_tx_bytes + row.ws_tx_bytes,
        requestCount: row.request_count,
        wsMessageCount: row.ws_message_count
      }
    }));
  }

  /**
   * Public/authenticated directory lookup for messaging peer discovery (only returns safe public fields of active Nodes).
   */
  searchDirectory({ query = "", limit = 30 } = {}) {
    const safeLimit = Math.min(Math.max(Number(limit) || 30, 1), 100);
    const trimmed = String(query || "").trim();
    const rows = trimmed
      ? this.db
          .prepare(
            `SELECT id, username, display_name, last_seen_at
             FROM accounts
             WHERE status = 'active' AND (username LIKE ? OR display_name LIKE ?)
             ORDER BY username ASC
             LIMIT ?`
          )
          .all(`%${trimmed}%`, `%${trimmed}%`, safeLimit)
      : this.db
          .prepare(
            `SELECT id, username, display_name, last_seen_at
             FROM accounts
             WHERE status = 'active'
             ORDER BY username ASC
             LIMIT ?`
          )
          .all(safeLimit);

    const onlineSet = new Set(this.eventHub ? this.eventHub.getOnlineAccountIds() : []);
    return rows.map((row) => ({
      id: row.id,
      nodeId: row.id,
      username: row.username,
      displayName: row.display_name || row.username,
      online: onlineSet.has(row.id),
      lastSeenAt: row.last_seen_at
    }));
  }

  updateProfile(nodeId, { displayName }) {
    if (!isValidDisplayName(displayName)) {
      throw new Error("Display name must be between 1 and 64 characters.");
    }
    const now = nowIso();
    const res = this.db
      .prepare("UPDATE accounts SET display_name = ?, updated_at = ? WHERE id = ?")
      .run(displayName.trim(), now, nodeId);
    if (res.changes === 0) return null;
    return this.getNodeById(nodeId);
  }

  /**
   * Administrative Node lifecycle change (`active`, `suspended`, `disabled`).
   * Suspending or disabling a Node immediately revokes all active sessions and disconnects live WebSockets.
   */
  setNodeStatus({ nodeId, status, actorId = "admin", reason = null }) {
    if (!isValidNodeStatus(status)) {
      throw new Error(`Invalid Node status "${status}".`);
    }
    const existing = this.db.prepare("SELECT id, status FROM accounts WHERE id = ?").get(nodeId);
    if (!existing) return null;

    const now = nowIso();
    this.db
      .prepare("UPDATE accounts SET status = ?, updated_at = ? WHERE id = ?")
      .run(status, now, nodeId);

    let revokedSessions = 0;
    let disconnectedSockets = 0;

    if (status !== "active") {
      if (this.sessionService) {
        const res = this.sessionService.revokeAllSessionsForAccount({
          accountId: nodeId,
          actorType: "admin",
          actorId,
          reason: reason || `node_${status}`
        });
        revokedSessions = res.revokedCount;
        disconnectedSockets = res.disconnectedSockets;
      } else if (this.eventHub) {
        disconnectedSockets = this.eventHub.disconnectAccount(
          nodeId,
          WS_CLOSE_CODES.NODE_SUSPENDED,
          `Node ${status}`
        );
      }
    }

    if (this.auditService) {
      this.auditService.record({
        actorType: "admin",
        actorId,
        action: `node.status.${status}`,
        targetType: "node",
        targetId: nodeId,
        outcome: "success",
        details: { previousStatus: existing.status, newStatus: status, reason, revokedSessions, disconnectedSockets }
      });
    }

    return {
      node: this.getNodeById(nodeId),
      revokedSessions,
      disconnectedSockets
    };
  }
}
