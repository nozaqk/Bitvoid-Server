import os from "node:os";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { getDatabaseStats } from "../db/database.js";
import { nowIso } from "../security/crypto.js";

function computeDirSizeBytes(dirPath) {
  if (!dirPath || !existsSync(dirPath)) return 0;
  let total = 0;
  let entries;
  try {
    entries = readdirSync(dirPath, { withFileTypes: true });
  } catch {
    return 0;
  }
  for (const entry of entries) {
    const full = join(dirPath, entry.name);
    try {
      if (entry.isDirectory()) {
        total += computeDirSizeBytes(full);
      } else if (entry.isFile()) {
        total += statSync(full).size;
      }
    } catch {
      // ignore races
    }
  }
  return total;
}

/**
 * Read OS-level network interface rx/tx byte counters where available (Linux /proc/net/dev).
 * Returns null counters with a clear note on platforms without a direct procfs reader.
 */
export function readOsInterfaceCounters() {
  if (process.platform === "linux" && existsSync("/proc/net/dev")) {
    try {
      const content = readFileSync("/proc/net/dev", "utf8");
      const lines = content.split("\n").slice(2);
      const counters = {};
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        const [ifacePart, rest] = trimmed.split(":");
        if (!rest) continue;
        const iface = ifacePart.trim();
        const cols = rest.trim().split(/\s+/);
        if (cols.length >= 10) {
          counters[iface] = {
            rxBytes: Number(cols[0]) || 0,
            rxPackets: Number(cols[1]) || 0,
            txBytes: Number(cols[8]) || 0,
            txPackets: Number(cols[9]) || 0
          };
        }
      }
      return { available: true, source: "/proc/net/dev", interfaces: counters };
    } catch {
      // fall through
    }
  }
  return {
    available: false,
    source: process.platform,
    interfaces: {},
    note: "OS-level interface byte counters require platform adapter support on this OS; per-Node application traffic remains accurately measured."
  };
}

/**
 * Truthful Server Metrics & Per-Node Traffic Accounting Service.
 * - Per-Node traffic = exact authenticated HTTP request/response bytes + WebSocket frame bytes.
 * - Never fabricates or divides interface traffic equally across Nodes.
 */
export class MetricsService {
  constructor({ db, config, eventHub = null }) {
    this.db = db;
    this.config = config;
    this.eventHub = eventHub;
    this.startedAtMs = Date.now();
    this.lastCpuUsage = process.cpuUsage();
    this.lastCpuSampleMs = Date.now();
    this.lastTrafficSample = {
      timestampMs: Date.now(),
      appRxBytes: 0,
      appTxBytes: 0
    };
    this.totalAppRxBytes = 0;
    this.totalAppTxBytes = 0;
    this.totalHttpRequests = 0;

    // Buffered per-Node deltas flushed periodically or on read for low write amplification.
    this.pendingNodeTraffic = new Map();
    this._upsertTrafficStmt = db.prepare(`
      INSERT INTO node_traffic_stats (
        account_id, http_rx_bytes, http_tx_bytes, ws_rx_bytes, ws_tx_bytes,
        request_count, ws_message_count, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(account_id) DO UPDATE SET
        http_rx_bytes = node_traffic_stats.http_rx_bytes + excluded.http_rx_bytes,
        http_tx_bytes = node_traffic_stats.http_tx_bytes + excluded.http_tx_bytes,
        ws_rx_bytes = node_traffic_stats.ws_rx_bytes + excluded.ws_rx_bytes,
        ws_tx_bytes = node_traffic_stats.ws_tx_bytes + excluded.ws_tx_bytes,
        request_count = node_traffic_stats.request_count + excluded.request_count,
        ws_message_count = node_traffic_stats.ws_message_count + excluded.ws_message_count,
        updated_at = excluded.updated_at
    `);
  }

  attachEventHub(eventHub) {
    this.eventHub = eventHub;
  }

  _getPending(accountId) {
    let entry = this.pendingNodeTraffic.get(accountId);
    if (!entry) {
      entry = {
        httpRx: 0,
        httpTx: 0,
        wsRx: 0,
        wsTx: 0,
        requests: 0,
        wsMessages: 0
      };
      this.pendingNodeTraffic.set(accountId, entry);
    }
    return entry;
  }

  recordHttpTraffic(accountId, rxBytes, txBytes) {
    const safeRx = Math.max(0, Number(rxBytes) || 0);
    const safeTx = Math.max(0, Number(txBytes) || 0);
    this.totalAppRxBytes += safeRx;
    this.totalAppTxBytes += safeTx;
    this.totalHttpRequests += 1;

    if (accountId) {
      const entry = this._getPending(accountId);
      entry.httpRx += safeRx;
      entry.httpTx += safeTx;
      entry.requests += 1;
    }
  }

  recordNodeWsTraffic(accountId, rxBytes, txBytes, messageCount = 1) {
    const safeRx = Math.max(0, Number(rxBytes) || 0);
    const safeTx = Math.max(0, Number(txBytes) || 0);
    this.totalAppRxBytes += safeRx;
    this.totalAppTxBytes += safeTx;

    if (accountId) {
      const entry = this._getPending(accountId);
      entry.wsRx += safeRx;
      entry.wsTx += safeTx;
      entry.wsMessages += messageCount;
    }
  }

  flushTrafficToDb() {
    if (this.pendingNodeTraffic.size === 0) return;
    const snapshot = [...this.pendingNodeTraffic.entries()];
    this.pendingNodeTraffic.clear();
    const now = nowIso();
    const tx = this.db.transaction((entries) => {
      for (const [accountId, d] of entries) {
        try {
          this._upsertTrafficStmt.run(
            accountId,
            d.httpRx,
            d.httpTx,
            d.wsRx,
            d.wsTx,
            d.requests,
            d.wsMessages,
            now
          );
        } catch {
          // Account may have been deleted concurrently; skip silently.
        }
      }
    });
    tx(snapshot);
  }

  getNodeTraffic(accountId) {
    this.flushTrafficToDb();
    const row = this.db
      .prepare(
        `SELECT http_rx_bytes, http_tx_bytes, ws_rx_bytes, ws_tx_bytes,
                request_count, ws_message_count, updated_at
         FROM node_traffic_stats
         WHERE account_id = ?`
      )
      .get(accountId);
    if (!row) {
      return {
        httpRxBytes: 0,
        httpTxBytes: 0,
        wsRxBytes: 0,
        wsTxBytes: 0,
        totalRxBytes: 0,
        totalTxBytes: 0,
        requestCount: 0,
        wsMessageCount: 0,
        updatedAt: null
      };
    }
    return {
      httpRxBytes: row.http_rx_bytes,
      httpTxBytes: row.http_tx_bytes,
      wsRxBytes: row.ws_rx_bytes,
      wsTxBytes: row.ws_tx_bytes,
      totalRxBytes: row.http_rx_bytes + row.ws_rx_bytes,
      totalTxBytes: row.http_tx_bytes + row.ws_tx_bytes,
      requestCount: row.request_count,
      wsMessageCount: row.ws_message_count,
      updatedAt: row.updated_at
    };
  }

  getAllNodeTraffic() {
    this.flushTrafficToDb();
    return this.db
      .prepare(
        `SELECT a.id AS node_id, a.username, a.display_name, a.status,
                COALESCE(t.http_rx_bytes, 0) AS http_rx_bytes,
                COALESCE(t.http_tx_bytes, 0) AS http_tx_bytes,
                COALESCE(t.ws_rx_bytes, 0) AS ws_rx_bytes,
                COALESCE(t.ws_tx_bytes, 0) AS ws_tx_bytes,
                COALESCE(t.request_count, 0) AS request_count,
                COALESCE(t.ws_message_count, 0) AS ws_message_count,
                t.updated_at
         FROM accounts a
         LEFT JOIN node_traffic_stats t ON t.account_id = a.id
         ORDER BY (COALESCE(t.http_rx_bytes, 0) + COALESCE(t.http_tx_bytes, 0) + COALESCE(t.ws_rx_bytes, 0) + COALESCE(t.ws_tx_bytes, 0)) DESC`
      )
      .all()
      .map((row) => ({
        nodeId: row.node_id,
        username: row.username,
        displayName: row.display_name || row.username,
        status: row.status,
        httpRxBytes: row.http_rx_bytes,
        httpTxBytes: row.http_tx_bytes,
        wsRxBytes: row.ws_rx_bytes,
        wsTxBytes: row.ws_tx_bytes,
        totalRxBytes: row.http_rx_bytes + row.ws_rx_bytes,
        totalTxBytes: row.http_tx_bytes + row.ws_tx_bytes,
        requestCount: row.request_count,
        wsMessageCount: row.ws_message_count,
        updatedAt: row.updated_at
      }));
  }

  collectSnapshot() {
    this.flushTrafficToDb();
    const nowMs = Date.now();
    const nowIsoStr = new Date(nowMs).toISOString();

    // Process CPU usage delta since previous sample.
    const cpuDelta = process.cpuUsage(this.lastCpuUsage);
    const elapsedMs = Math.max(1, nowMs - this.lastCpuSampleMs);
    const cpuPercent = Number(
      (((cpuDelta.user + cpuDelta.system) / 1000 / elapsedMs) * 100).toFixed(2)
    );
    this.lastCpuUsage = process.cpuUsage();
    this.lastCpuSampleMs = nowMs;

    // Throughput delta since last snapshot.
    const rateElapsedSec = Math.max(0.001, (nowMs - this.lastTrafficSample.timestampMs) / 1000);
    const rxBytesPerSec = Math.round(
      (this.totalAppRxBytes - this.lastTrafficSample.appRxBytes) / rateElapsedSec
    );
    const txBytesPerSec = Math.round(
      (this.totalAppTxBytes - this.lastTrafficSample.appTxBytes) / rateElapsedSec
    );
    this.lastTrafficSample = {
      timestampMs: nowMs,
      appRxBytes: this.totalAppRxBytes,
      appTxBytes: this.totalAppTxBytes
    };

    const mem = process.memoryUsage();
    const totalHostMem = os.totalmem();
    const freeHostMem = os.freemem();

    const dbStats = getDatabaseStats(this.db, this.config.databasePath);
    const mediaBytes = computeDirSizeBytes(this.config.mediaDir);
    const backupBytes = computeDirSizeBytes(this.config.backupDir);
    const logBytes = computeDirSizeBytes(this.config.logDir);

    const nodeCounts = this.db
      .prepare(
        `SELECT
           COUNT(*) AS total,
           SUM(CASE WHEN status = 'active' THEN 1 ELSE 0 END) AS active,
           SUM(CASE WHEN status = 'suspended' THEN 1 ELSE 0 END) AS suspended,
           SUM(CASE WHEN status = 'disabled' THEN 1 ELSE 0 END) AS disabled
         FROM accounts`
      )
      .get();

    const deviceCounts = this.db
      .prepare(
        `SELECT
           COUNT(*) AS total,
           SUM(CASE WHEN revoked_at IS NULL THEN 1 ELSE 0 END) AS active,
           SUM(CASE WHEN revoked_at IS NOT NULL THEN 1 ELSE 0 END) AS revoked
         FROM devices`
      )
      .get();

    const sessionCounts = this.db
      .prepare(
        `SELECT
           COUNT(*) AS total,
           SUM(CASE WHEN revoked_at IS NULL AND expires_at > ? THEN 1 ELSE 0 END) AS active,
           SUM(CASE WHEN revoked_at IS NULL AND expires_at <= ? THEN 1 ELSE 0 END) AS expired,
           SUM(CASE WHEN revoked_at IS NOT NULL THEN 1 ELSE 0 END) AS revoked,
           COUNT(DISTINCT CASE WHEN revoked_at IS NULL AND expires_at > ? THEN account_id END) AS nodesWithActiveSessions
         FROM sessions`
      )
      .get(nowIsoStr, nowIsoStr, nowIsoStr);

    const wsStats = this.eventHub
      ? this.eventHub.getStats()
      : { activeConnections: 0, onlineNodes: 0, connectedSessions: 0, connectedDevices: 0, activeTopics: 0 };

    const totalNodes = nodeCounts?.total || 0;
    const onlineNodes = wsStats.onlineNodes;

    return {
      sampledAt: nowIsoStr,
      uptimeSeconds: Math.floor((nowMs - this.startedAtMs) / 1000),
      nodes: {
        total: totalNodes,
        activeAccounts: nodeCounts?.active || 0,
        suspended: nodeCounts?.suspended || 0,
        disabled: nodeCounts?.disabled || 0,
        onlineWebsocket: onlineNodes,
        withActiveSessions: sessionCounts?.nodesWithActiveSessions || 0,
        offlineWebsocket: Math.max(0, totalNodes - onlineNodes)
      },
      devices: {
        total: deviceCounts?.total || 0,
        active: deviceCounts?.active || 0,
        revoked: deviceCounts?.revoked || 0
      },
      sessions: {
        total: sessionCounts?.total || 0,
        active: sessionCounts?.active || 0,
        expired: sessionCounts?.expired || 0,
        revoked: sessionCounts?.revoked || 0
      },
      realtime: wsStats,
      process: {
        pid: process.pid,
        nodeVersion: process.version,
        platform: process.platform,
        arch: process.arch,
        cpuPercent,
        rssBytes: mem.rss,
        heapUsedBytes: mem.heapUsed,
        heapTotalBytes: mem.heapTotal
      },
      host: {
        hostname: os.hostname(),
        cpus: os.cpus().length,
        loadAvg: os.loadavg(),
        totalMemoryBytes: totalHostMem,
        freeMemoryBytes: freeHostMem,
        usedMemoryBytes: totalHostMem - freeHostMem
      },
      storage: {
        databaseBytes: dbStats.totalDiskBytes,
        databaseFileBytes: dbStats.fileSizeBytes,
        databaseWalBytes: dbStats.walSizeBytes,
        mediaBytes,
        backupBytes,
        logBytes,
        totalManagedBytes: dbStats.totalDiskBytes + mediaBytes + backupBytes + logBytes
      },
      traffic: {
        appRxBytes: this.totalAppRxBytes,
        appTxBytes: this.totalAppTxBytes,
        appRxBytesPerSec: Math.max(0, rxBytesPerSec),
        appTxBytesPerSec: Math.max(0, txBytesPerSec),
        totalHttpRequests: this.totalHttpRequests,
        osInterfaces: readOsInterfaceCounters()
      }
    };
  }
}
