import net from "node:net";
import { chmodSync, existsSync, mkdirSync, unlinkSync } from "node:fs";
import { dirname } from "node:path";
import { SERVER_VERSION } from "../config/constants.js";
import { getDatabaseStats, runIntegrityCheck } from "../db/database.js";
import { getMigrationStatus } from "../db/migrator.js";
import { MIGRATIONS } from "../db/migrations/index.js";
import { inspectNetworkInterfaces } from "../network/interfaceMonitor.js";

const MAX_IPC_LINE_BYTES = 1024 * 1024; // 1 MiB per JSON-RPC frame

/**
 * Protected Local Administration IPC Server.
 * - Listens ONLY on a local Unix domain socket (chmod 0600) or Windows Named Pipe.
 * - NEVER exposed on the public LAN/Internet HTTP port.
 * - Speaks newline-delimited JSON-RPC 2.0 so both the native Qt 6 Desktop Dashboard (QLocalSocket)
 *   and the `bitvoid-admin` CLI share one exact management protocol.
 */
export class AdminIpcServer {
  constructor({ ctx, onShutdownRequested = null }) {
    this.ctx = ctx;
    this.onShutdownRequested = onShutdownRequested;
    this.ipcPath = ctx.config.ipcPath;
    this.server = null;
    this.listening = false;
  }

  async start() {
    if (this.listening) return { ipcPath: this.ipcPath };

    const isNamedPipe = this.ipcPath.startsWith("\\\\.\\pipe\\");
    if (!isNamedPipe) {
      mkdirSync(dirname(this.ipcPath), { recursive: true, mode: 0o700 });
      if (existsSync(this.ipcPath)) {
        try {
          unlinkSync(this.ipcPath);
        } catch {
          // ignore stale socket cleanup errors
        }
      }
    }

    // Ensure first-run enrollment file is prepared when no admin exists yet.
    this.ctx.adminAuthService.ensureFirstRunEnrollmentToken();

    this.server = net.createServer((socket) => this._handleClient(socket));

    await new Promise((resolve, reject) => {
      this.server.once("error", reject);
      this.server.listen(this.ipcPath, () => {
        this.server.off("error", reject);
        resolve();
      });
    });

    if (!isNamedPipe && process.platform !== "win32") {
      chmodSync(this.ipcPath, 0o600);
    }

    this.listening = true;
    this.ctx.logService.write({
      level: "info",
      component: "ipc",
      eventCode: "ipc.started",
      message: `Protected local administration IPC listening on ${this.ipcPath}`
    });

    return { ipcPath: this.ipcPath };
  }

  async stop() {
    if (!this.server) return;
    const srv = this.server;
    this.server = null;
    this.listening = false;
    await new Promise((resolve) => srv.close(() => resolve()));

    const isNamedPipe = this.ipcPath.startsWith("\\\\.\\pipe\\");
    if (!isNamedPipe && existsSync(this.ipcPath)) {
      try {
        unlinkSync(this.ipcPath);
      } catch {
        // ignore
      }
    }
  }

  _handleClient(socket) {
    let buffer = "";

    socket.on("data", async (chunk) => {
      buffer += chunk.toString("utf8");
      if (Buffer.byteLength(buffer, "utf8") > MAX_IPC_LINE_BYTES) {
        socket.write(
          `${JSON.stringify({ jsonrpc: "2.0", id: null, error: { code: -32600, message: "Frame too large" } })}\n`
        );
        socket.destroy();
        return;
      }

      let nlIndex;
      while ((nlIndex = buffer.indexOf("\n")) !== -1) {
        const line = buffer.slice(0, nlIndex).trim();
        buffer = buffer.slice(nlIndex + 1);
        if (!line) continue;
        const response = await this._processLine(line);
        if (!socket.destroyed) {
          socket.write(`${JSON.stringify(response)}\n`);
        }
      }
    });
  }

  async _processLine(line) {
    let req;
    try {
      req = JSON.parse(line);
    } catch {
      return { jsonrpc: "2.0", id: null, error: { code: -32700, message: "Parse error" } };
    }

    const id = req?.id ?? null;
    const method = req?.method;
    const params = req?.params && typeof req.params === "object" ? req.params : {};
    const authToken = req?.authToken || null;

    if (typeof method !== "string") {
      return { jsonrpc: "2.0", id, error: { code: -32600, message: "Invalid JSON-RPC request." } };
    }

    try {
      const result = await this._dispatch(method, params, authToken);
      return { jsonrpc: "2.0", id, result };
    } catch (err) {
      return {
        jsonrpc: "2.0",
        id,
        error: {
          code: err.rpcCode || -32000,
          errorCode: err.code || "ipc_error",
          message: err.message || "Administration command failed."
        }
      };
    }
  }

  _requireAdmin(authToken) {
    if (!authToken) {
      const err = new Error("Administrator authentication is required.");
      err.rpcCode = -32001;
      err.code = "unauthenticated";
      throw err;
    }
    const verified = this.ctx.adminAuthService.verifyAdminToken(authToken);
    if (!verified.ok) {
      const err = new Error(verified.message);
      err.rpcCode = -32001;
      err.code = "unauthenticated";
      throw err;
    }
    return verified;
  }

  async _dispatch(method, params, authToken) {
    const {
      config,
      db,
      serverId,
      tlsContext,
      adminAuthService,
      metricsService,
      nodeService,
      deviceService,
      sessionService,
      backupService,
      auditService,
      logService,
      configStore,
      discoveryService,
      hotspotManager,
      vpnProfileManager,
      updateService,
      loginRateLimiter,
      recoveryRateLimiter
    } = this.ctx;

    // 1. Minimal unauthenticated local-only bootstrap/login endpoints.
    if (method === "admin.status") {
      const enrollment = adminAuthService.ensureFirstRunEnrollmentToken();
      return {
        serverId,
        displayName: config.displayName,
        version: SERVER_VERSION,
        deploymentMode: config.deploymentMode,
        networkMode: config.networkMode,
        initialized: enrollment.initialized,
        enrollmentRequired: enrollment.enrollmentRequired,
        enrollmentFilePath: enrollment.enrollmentFilePath
      };
    }

    if (method === "admin.setup") {
      return adminAuthService.completeFirstRunSetup({
        enrollmentCode: params.enrollmentCode,
        username: params.username,
        password: params.password,
        clientInfo: params.clientInfo || "desktop-dashboard"
      });
    }

    if (method === "admin.login") {
      return adminAuthService.login({
        username: params.username,
        password: params.password,
        clientInfo: params.clientInfo || "desktop-dashboard"
      });
    }

    // 2. All remaining administration commands require an active verified administrator session.
    const adminCtx = this._requireAdmin(authToken);
    const adminId = adminCtx.admin.id;

    switch (method) {
      case "admin.logout":
        return adminAuthService.revokeAdminSession(adminCtx.sessionId, adminId);

      // Overview & Realtime Monitoring
      case "overview.get":
      case "metrics.snapshot": {
        const snapshot = metricsService.collectSnapshot();
        const security24h = auditService.countSecurityEventsSince(
          new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()
        );
        return {
          server: {
            serverId,
            displayName: config.displayName,
            version: SERVER_VERSION,
            deploymentMode: config.deploymentMode,
            networkMode: config.networkMode,
            host: config.host,
            port: config.port,
            tlsEnabled: tlsContext.enabled,
            tlsWarning: tlsContext.warning
          },
          metrics: snapshot,
          security24h,
          discovery: discoveryService.getStatus(),
          hotspot: hotspotManager.getStatus()
        };
      }

      case "metrics.nodeTraffic":
        return { nodes: metricsService.getAllNodeTraffic() };

      // Nodes (Accounts) Management
      case "nodes.list":
        return {
          nodes: nodeService.listNodes({
            search: params.search || "",
            status: params.status || null,
            limit: params.limit || 100,
            offset: params.offset || 0
          })
        };

      case "nodes.get": {
        const node = nodeService.getNodeById(params.nodeId);
        if (!node) throw new Error("Node not found.");
        return {
          node,
          devices: deviceService.listDevicesForAccount(node.id),
          sessions: sessionService.listSessionsForAccount(node.id)
        };
      }

      case "nodes.setStatus": {
        const res = nodeService.setNodeStatus({
          nodeId: params.nodeId,
          status: params.status,
          actorId: adminId,
          reason: params.reason || null
        });
        if (!res) throw new Error("Node not found.");
        return res;
      }

      // Devices & Sessions Management
      case "devices.list":
        return {
          devices: deviceService.listAllDevices({
            accountId: params.nodeId || null,
            includeRevoked: params.includeRevoked !== false
          })
        };

      case "devices.revoke": {
        const res = deviceService.revokeDevice({
          deviceId: params.deviceId,
          actorType: "admin",
          actorId: adminId,
          reason: params.reason || "admin_revoked"
        });
        if (!res) throw new Error("Device not found.");
        return { device: res };
      }

      case "sessions.list":
        return {
          sessions: sessionService.listAllSessions({
            accountId: params.nodeId || null,
            status: params.status || "all",
            limit: params.limit || 200
          })
        };

      case "sessions.revoke": {
        const res = sessionService.revokeSession({
          sessionId: params.sessionId,
          actorType: "admin",
          actorId: adminId,
          reason: params.reason || "admin_revoked"
        });
        if (!res) throw new Error("Session not found.");
        return res;
      }

      case "sessions.cleanup":
        return sessionService.cleanupExpiredSessions({
          retentionDays: params.retentionDays ?? 30
        });

      // Network, Hotspot & VPN Management
      case "network.overview": {
        const interfaces = inspectNetworkInterfaces({
          port: config.port,
          tlsEnabled: tlsContext.enabled,
          hostBind: config.host
        });
        const hotspotCapability = await hotspotManager.detectCapability();
        return {
          deploymentMode: config.deploymentMode,
          networkMode: config.networkMode,
          interfaces,
          discovery: discoveryService.getStatus(),
          hotspot: {
            status: hotspotManager.getStatus(),
            capability: hotspotCapability
          },
          vpnProfiles: vpnProfileManager.listProfiles()
        };
      }

      case "network.hotspot.capability":
        return hotspotManager.detectCapability();

      case "network.hotspot.start":
        return hotspotManager.startHotspot({
          ssid: params.ssid || "BitVoid-Local",
          passphrase: params.passphrase || null,
          interfaceName: params.interfaceName || null,
          actorId: adminId
        });

      case "network.hotspot.stop":
        return hotspotManager.stopHotspot({ actorId: adminId });

      case "network.vpn.list":
        return { profiles: vpnProfileManager.listProfiles() };

      case "network.vpn.create":
        return {
          profile: vpnProfileManager.createProfile({
            ...params,
            actorId: adminId
          })
        };

      case "network.vpn.delete":
        return { deleted: vpnProfileManager.deleteProfile(params.profileId, { actorId: adminId }) };

      case "network.trustBootstrap":
        return vpnProfileManager.buildTrustBootstrapPayload({
          endpointUrl: params.endpointUrl || null,
          profileName: params.profileName || null
        });

      // Logs & Audit Events
      case "logs.query":
        return {
          entries: logService.query({
            level: params.level || null,
            component: params.component || null,
            search: params.search || null,
            limit: params.limit || 100
          }),
          rotation: logService.getRotationStatus()
        };

      case "audit.query":
        return {
          events: auditService.query({
            actorType: params.actorType || null,
            actorId: params.actorId || null,
            action: params.action || null,
            outcome: params.outcome || null,
            since: params.since || null,
            beforeSeq: params.beforeSeq || null,
            limit: params.limit || 100
          })
        };

      // Security Dashboard
      case "security.overview":
        return {
          tls: {
            enabled: tlsContext.enabled,
            certificate: tlsContext.certificateInfo,
            warning: tlsContext.warning
          },
          adminSessions: adminAuthService.listAdminSessions(),
          rateLimiters: {
            login: loginRateLimiter.snapshotStats(),
            recovery: recoveryRateLimiter.snapshotStats()
          },
          securityEvents24h: auditService.countSecurityEventsSince(
            new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()
          )
        };

      case "security.revokeAdminSession":
        return adminAuthService.revokeAdminSession(params.sessionId, adminId);

      // Backups & Database Management
      case "backups.list":
        return { backups: backupService.listBackups() };

      case "backups.create":
        return {
          backup: await backupService.createBackup({
            createdBy: adminId,
            passphrase: params.passphrase || null,
            includeMedia: params.includeMedia !== false
          })
        };

      case "backups.verify":
        return backupService.verifyBackup(params.backupId || params.filePath, {
          passphrase: params.passphrase || null
        });

      case "backups.prune":
        return backupService.pruneOldBackups(params.keepCount ?? 10);

      case "database.status":
        return {
          databasePath: config.databasePath,
          stats: getDatabaseStats(db, config.databasePath),
          migrations: getMigrationStatus(db, MIGRATIONS),
          integrity: runIntegrityCheck(db)
        };

      case "database.integrityCheck":
        return runIntegrityCheck(db);

      // Server & Encrypted Configuration
      case "config.get":
        return {
          serverId,
          displayName: config.displayName,
          host: config.host,
          port: config.port,
          deploymentMode: config.deploymentMode,
          networkMode: config.networkMode,
          mdnsEnabled: config.mdnsEnabled,
          tokenTtl: config.tokenTtl,
          refreshTtl: config.refreshTtl,
          maxUploadBytes: config.maxUploadBytes,
          nodeStorageQuotaBytes: config.nodeStorageQuotaBytes,
          dataDir: config.dataDir,
          databasePath: config.databasePath,
          mediaDir: config.mediaDir,
          backupDir: config.backupDir,
          logDir: config.logDir,
          ipcPath: config.ipcPath,
          tlsEnabled: tlsContext.enabled,
          encryptedConfigKeys: configStore.listKeys()
        };

      case "config.setEncrypted":
        configStore.set(params.key, params.value, adminId);
        auditService.record({
          actorType: "admin",
          actorId: adminId,
          action: "config.encrypted.set",
          targetType: "config_key",
          targetId: params.key,
          outcome: "success"
        });
        return { saved: true, key: params.key };

      case "config.deleteEncrypted":
        return { deleted: configStore.delete(params.key), key: params.key };

      // Software Updates
      case "updates.status":
        return updateService.getStatus();

      case "updates.loadManifest":
        return updateService.loadReleaseManifest(params.manifest);

      case "updates.verifyArtifact":
        return updateService.verifyArtifactFile(params.filePath, params.expectedSha256);

      // Service Lifecycle
      case "service.status":
        return {
          running: true,
          pid: process.pid,
          uptimeSeconds: Math.floor((Date.now() - metricsService.startedAtMs) / 1000),
          version: SERVER_VERSION,
          ipcPath: this.ipcPath
        };

      case "service.shutdown":
        auditService.record({
          actorType: "admin",
          actorId: adminId,
          action: "service.shutdown",
          outcome: "success"
        });
        if (this.onShutdownRequested) {
          setTimeout(() => this.onShutdownRequested(), 150);
        }
        return { shuttingDown: true };

      default: {
        const err = new Error(`Unknown administration IPC method: ${method}`);
        err.rpcCode = -32601;
        err.code = "method_not_found";
        throw err;
      }
    }
  }
}
