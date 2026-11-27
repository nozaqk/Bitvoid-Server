import { WS_CLOSE_CODES } from "../config/constants.js";
import { generateOpaqueId, nowIso } from "../security/crypto.js";

/**
 * Authenticated WebSocket Connection Hub.
 * Tracks every open socket by session, device, and Node (account), supports topic subscriptions,
 * accurate per-Node WebSocket byte accounting, and immediate forced closure on session/device
 * revocation or Node suspension.
 */
export class EventHub {
  constructor({ metricsService = null, logService = null } = {}) {
    this.metricsService = metricsService;
    this.logService = logService;
    this.connections = new Map(); // connectionId -> conn
    this.bySession = new Map(); // sessionId -> Set<connectionId>
    this.byDevice = new Map(); // deviceId -> Set<connectionId>
    this.byAccount = new Map(); // accountId -> Set<connectionId>
    this.byTopic = new Map(); // topic -> Set<connectionId>
  }

  _addToIndex(map, key, connectionId) {
    if (!key) return;
    let set = map.get(key);
    if (!set) {
      set = new Set();
      map.set(key, set);
    }
    set.add(connectionId);
  }

  _removeFromIndex(map, key, connectionId) {
    if (!key) return;
    const set = map.get(key);
    if (!set) return;
    set.delete(connectionId);
    if (set.size === 0) map.delete(key);
  }

  register({ socket, accountId, username, sessionId, deviceId = null, expiresAt }) {
    const id = generateOpaqueId("wsc");
    const conn = {
      id,
      socket,
      accountId,
      username,
      sessionId,
      deviceId,
      expiresAtMs: expiresAt ? Date.parse(expiresAt) : Number.POSITIVE_INFINITY,
      connectedAt: nowIso(),
      topics: new Set()
    };

    this.connections.set(id, conn);
    this._addToIndex(this.bySession, sessionId, id);
    this._addToIndex(this.byDevice, deviceId, id);
    this._addToIndex(this.byAccount, accountId, id);

    socket.on("close", () => {
      this.unregister(id);
    });

    return conn;
  }

  unregister(connectionId) {
    const conn = this.connections.get(connectionId);
    if (!conn) return;
    this.connections.delete(connectionId);
    this._removeFromIndex(this.bySession, conn.sessionId, connectionId);
    this._removeFromIndex(this.byDevice, conn.deviceId, connectionId);
    this._removeFromIndex(this.byAccount, conn.accountId, connectionId);
    for (const topic of conn.topics) {
      this._removeFromIndex(this.byTopic, topic, connectionId);
    }
    conn.topics.clear();
  }

  subscribe(connectionId, topic) {
    const conn = this.connections.get(connectionId);
    if (!conn) return false;
    conn.topics.add(topic);
    this._addToIndex(this.byTopic, topic, connectionId);
    return true;
  }

  unsubscribe(connectionId, topic) {
    const conn = this.connections.get(connectionId);
    if (!conn) return false;
    conn.topics.delete(topic);
    this._removeFromIndex(this.byTopic, topic, connectionId);
    return true;
  }

  recordInboundBytes(connectionId, byteLength) {
    const conn = this.connections.get(connectionId);
    if (!conn || !this.metricsService) return;
    this.metricsService.recordNodeWsTraffic(conn.accountId, byteLength, 0, 1);
  }

  sendToConnection(connectionId, eventObject) {
    const conn = this.connections.get(connectionId);
    if (!conn) return false;
    if (conn.socket.readyState !== 1) return false;
    const payload = JSON.stringify({
      eventId: eventObject.eventId || generateOpaqueId("evt"),
      occurredAt: eventObject.occurredAt || nowIso(),
      ...eventObject
    });
    const bytes = Buffer.byteLength(payload, "utf8");
    try {
      conn.socket.send(payload);
      if (this.metricsService) {
        this.metricsService.recordNodeWsTraffic(conn.accountId, 0, bytes, 1);
      }
      return true;
    } catch {
      return false;
    }
  }

  sendToAccount(accountId, eventObject, { excludeSessionId = null } = {}) {
    const ids = this.byAccount.get(accountId);
    if (!ids) return 0;
    let delivered = 0;
    for (const connId of [...ids]) {
      const conn = this.connections.get(connId);
      if (!conn) continue;
      if (excludeSessionId && conn.sessionId === excludeSessionId) continue;
      if (this.sendToConnection(connId, eventObject)) {
        delivered += 1;
      }
    }
    return delivered;
  }

  sendToAccounts(accountIds, eventObject, options = {}) {
    let total = 0;
    const unique = new Set(accountIds);
    for (const accountId of unique) {
      total += this.sendToAccount(accountId, eventObject, options);
    }
    return total;
  }

  sendToTopic(topic, eventObject, { excludeConnectionId = null } = {}) {
    const ids = this.byTopic.get(topic);
    if (!ids) return 0;
    let delivered = 0;
    for (const connId of [...ids]) {
      if (excludeConnectionId && connId === excludeConnectionId) continue;
      if (this.sendToConnection(connId, eventObject)) {
        delivered += 1;
      }
    }
    return delivered;
  }

  _closeConnections(connectionIds, code, reason) {
    if (!connectionIds || connectionIds.size === 0) return 0;
    let closed = 0;
    for (const connId of [...connectionIds]) {
      const conn = this.connections.get(connId);
      if (!conn) continue;
      this.unregister(connId);
      try {
        conn.socket.close(code, reason);
      } catch {
        // ignore close errors on already-closing sockets
      }
      closed += 1;
    }
    return closed;
  }

  disconnectSession(sessionId, code = WS_CLOSE_CODES.SESSION_REVOKED, reason = "Session revoked") {
    return this._closeConnections(this.bySession.get(sessionId), code, reason);
  }

  disconnectDevice(deviceId, code = WS_CLOSE_CODES.DEVICE_REVOKED, reason = "Device revoked") {
    return this._closeConnections(this.byDevice.get(deviceId), code, reason);
  }

  disconnectAccount(accountId, code = WS_CLOSE_CODES.NODE_SUSPENDED, reason = "Node session terminated") {
    return this._closeConnections(this.byAccount.get(accountId), code, reason);
  }

  disconnectExpiredSessions(nowMs = Date.now()) {
    let closed = 0;
    for (const conn of [...this.connections.values()]) {
      if (conn.expiresAtMs <= nowMs) {
        closed += this.disconnectSession(
          conn.sessionId,
          WS_CLOSE_CODES.SESSION_EXPIRED,
          "Session expired"
        );
      }
    }
    return closed;
  }

  disconnectAll(code = WS_CLOSE_CODES.SERVER_SHUTDOWN, reason = "Server shutting down") {
    return this._closeConnections(new Set(this.connections.keys()), code, reason);
  }

  isAccountOnline(accountId) {
    const set = this.byAccount.get(accountId);
    return Boolean(set && set.size > 0);
  }

  getOnlineAccountIds() {
    return [...this.byAccount.keys()];
  }

  getStats() {
    return {
      activeConnections: this.connections.size,
      onlineNodes: this.byAccount.size,
      connectedSessions: this.bySession.size,
      connectedDevices: this.byDevice.size,
      activeTopics: this.byTopic.size
    };
  }
}
