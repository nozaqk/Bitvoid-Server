import Fastify from "fastify";
import helmet from "@fastify/helmet";
import multipart from "@fastify/multipart";
import rateLimit from "@fastify/rate-limit";
import websocket from "@fastify/websocket";
import { mkdirSync } from "node:fs";
import { LIMITS } from "./config/constants.js";
import { loadConfig } from "./config/env.js";
import { getOrCreateServerId, openDatabase } from "./db/database.js";
import { runMigrations } from "./db/migrator.js";
import { MIGRATIONS } from "./db/migrations/index.js";
import { createPasswordHasher } from "./security/passwords.js";
import { createTokenManager } from "./security/tokens.js";
import { KeyedRateLimiter } from "./security/rateLimiter.js";
import { EncryptedConfigStore } from "./security/configStore.js";
import { FASTIFY_REDACT_PATHS } from "./security/redaction.js";
import { EventHub } from "./realtime/eventHub.js";
import { LogService } from "./services/logService.js";
import { AuditService } from "./services/auditService.js";
import { MetricsService } from "./services/metricsService.js";
import { BackupService } from "./services/backupService.js";
import { DeviceService } from "./services/deviceService.js";
import { SessionService } from "./services/sessionService.js";
import { NodeService } from "./services/nodeService.js";
import { AuthService } from "./services/authService.js";
import { SyncService } from "./services/syncService.js";
import { AttachmentService } from "./services/attachmentService.js";
import { MessagingService } from "./services/messagingService.js";
import { ChannelService } from "./services/channelService.js";
import { LiveClassService } from "./services/liveClassService.js";
import { loadTlsContext } from "./network/tlsManager.js";
import { DiscoveryService } from "./network/discoveryService.js";
import { registerErrorHandler } from "./routes/errorEnvelope.js";
import {
  createAuthenticatePreHandler,
  registerTrafficAccountingHooks
} from "./routes/authMiddleware.js";
import { registerSystemRoutes } from "./routes/systemRoutes.js";
import { registerAccountRoutes } from "./routes/accountRoutes.js";
import { registerAuthRoutes } from "./routes/authRoutes.js";
import { registerMessagingRoutes } from "./routes/messagingRoutes.js";
import { registerChannelRoutes } from "./routes/channelRoutes.js";
import { registerLiveClassRoutes } from "./routes/liveClassRoutes.js";
import { registerAttachmentRoutes } from "./routes/attachmentRoutes.js";
import { registerSyncRoutes } from "./routes/syncRoutes.js";
import { registerWsRoutes } from "./routes/wsRoutes.js";

/**
 * Construct a complete, modular BitVoid Server instance.
 * Does not bind TCP ports until `start()` or `app.listen()` is called,
 * making unit, integration, contract, and security testing fast and isolated.
 */
export async function createServerInstance({ config = null, env = process.env, overrides = {} } = {}) {
  const resolvedConfig = config || loadConfig(env, overrides);

  mkdirSync(resolvedConfig.dataDir, { recursive: true, mode: 0o700 });
  mkdirSync(resolvedConfig.mediaDir, { recursive: true, mode: 0o700 });
  mkdirSync(resolvedConfig.backupDir, { recursive: true, mode: 0o700 });
  mkdirSync(resolvedConfig.logDir, { recursive: true, mode: 0o700 });

  const db = openDatabase(resolvedConfig.databasePath);
  const migrationResult = runMigrations(db, MIGRATIONS, {
    dbPath: resolvedConfig.databasePath,
    preMigrationBackupDir: resolvedConfig.backupDir
  });
  const serverId = getOrCreateServerId(db);

  const tlsContext = loadTlsContext(resolvedConfig.tls);

  const logService = new LogService({
    logDir: resolvedConfig.logDir,
    minLevel: resolvedConfig.logLevel,
    persistToDisk: true
  });

  const auditService = new AuditService(db, logService);
  const configStore = new EncryptedConfigStore(db, resolvedConfig.tokenSecret);
  const passwordHasher = createPasswordHasher({
    fastTestHashing: resolvedConfig.fastTestHashing
  });
  const tokenManager = createTokenManager(resolvedConfig.tokenSecret);

  const metricsService = new MetricsService({ db, config: resolvedConfig });
  const eventHub = new EventHub({ metricsService, logService });
  metricsService.attachEventHub(eventHub);

  const backupService = new BackupService({
    db,
    config: resolvedConfig,
    serverId,
    auditService
  });

  const deviceService = new DeviceService({ db, eventHub, auditService });
  const sessionService = new SessionService({
    db,
    config: resolvedConfig,
    tokenManager,
    eventHub,
    auditService
  });
  const nodeService = new NodeService({
    db,
    eventHub,
    metricsService,
    sessionService,
    auditService
  });

  const loginRateLimiter = new KeyedRateLimiter({
    maxAttempts: Math.max(5, resolvedConfig.authRateLimitMax),
    windowMs: 15 * 60 * 1000,
    lockoutMs: 15 * 60 * 1000
  });
  const recoveryRateLimiter = new KeyedRateLimiter({
    maxAttempts: 5,
    windowMs: 15 * 60 * 1000,
    lockoutMs: 30 * 60 * 1000
  });

  const authService = new AuthService({
    db,
    passwordHasher,
    deviceService,
    sessionService,
    nodeService,
    auditService,
    loginRateLimiter,
    recoveryRateLimiter
  });

  const discoveryService = new DiscoveryService({
    config: resolvedConfig,
    serverId,
    logService
  });

  const syncService = new SyncService({ db, eventHub });
  const attachmentService = new AttachmentService({
    db,
    config: resolvedConfig,
    auditService
  });
  const messagingService = new MessagingService({ db, syncService, eventHub });
  const channelService = new ChannelService({ db, syncService });
  const liveClassService = new LiveClassService({ db, syncService, eventHub });

  const authorizeTopicSubscription = ({ accountId, topic }) => {
    if (topic.startsWith("conversation:")) {
      return Boolean(messagingService.isMember(topic.slice("conversation:".length), accountId));
    }
    if (topic.startsWith("channel:")) {
      return channelService.canReadChannel(topic.slice("channel:".length), accountId);
    }
    if (topic.startsWith("live-class:")) {
      return Boolean(liveClassService.isActiveMember(topic.slice("live-class:".length), accountId));
    }
    return false;
  };

  const app = Fastify({
    logger: resolvedConfig.loggerEnabled
      ? {
          level: resolvedConfig.logLevel,
          redact: {
            paths: FASTIFY_REDACT_PATHS,
            censor: "[REDACTED]"
          }
        }
      : false,
    bodyLimit: LIMITS.JSON_BODY_LIMIT,
    trustProxy: resolvedConfig.trustProxy,
    https: tlsContext.fastifyHttps
  });

  await app.register(helmet, { contentSecurityPolicy: false });
  await app.register(rateLimit, {
    max: resolvedConfig.rateLimitMax,
    timeWindow: "1 minute"
  });
  await app.register(multipart, {
    limits: {
      fileSize: resolvedConfig.maxUploadBytes,
      files: 1,
      fields: 10
    }
  });
  await app.register(websocket, {
    options: {
      maxPayload: 256 * 1024 // 256 KiB per WS frame
    }
  });

  registerTrafficAccountingHooks(app, metricsService);
  registerErrorHandler(app, logService);

  const authenticate = createAuthenticatePreHandler(sessionService);

  // Truthful capability registry (only lists capabilities backed by implemented routes).
  const capabilities = new Set([
    "account-auth",
    "argon2id-passwords",
    "device-registration",
    "session-refresh",
    "session-revocation",
    "sqlite-persistence",
    "websocket-events",
    "encrypted-backups",
    "direct-messaging",
    "group-messaging",
    "message-receipts",
    "channels",
    "live-classes",
    "webrtc-signaling",
    "attachments",
    "durable-sync"
  ]);

  const ctx = {
    config: resolvedConfig,
    db,
    serverId,
    migrationResult,
    tlsContext,
    logService,
    auditService,
    configStore,
    passwordHasher,
    tokenManager,
    metricsService,
    eventHub,
    backupService,
    deviceService,
    sessionService,
    nodeService,
    authService,
    discoveryService,
    syncService,
    attachmentService,
    messagingService,
    channelService,
    liveClassService,
    loginRateLimiter,
    recoveryRateLimiter,
    authenticate,
    capabilities,
    getCapabilities: () => [...capabilities],
    authorizeTopicSubscription
  };

  registerSystemRoutes(app, ctx);
  registerAccountRoutes(app, ctx);
  registerAuthRoutes(app, ctx);
  registerMessagingRoutes(app, ctx);
  registerChannelRoutes(app, ctx);
  registerLiveClassRoutes(app, ctx);
  registerAttachmentRoutes(app, ctx);
  registerSyncRoutes(app, ctx);
  registerWsRoutes(app, ctx);

  // Periodic housekeeping (session expiry enforcement, expired signaling cleanup & per-Node traffic flush).
  const maintenanceTimer = setInterval(() => {
    try {
      metricsService.flushTrafficToDb();
      sessionService.cleanupExpiredSessions({ retentionDays: 30 });
      liveClassService.purgeExpiredSignals();
    } catch {
      // Never crash background housekeeping loop
    }
  }, 60_000);
  maintenanceTimer.unref();

  let closed = false;
  app.addHook("onClose", async () => {
    if (closed) return;
    closed = true;
    clearInterval(maintenanceTimer);
    discoveryService.stop();
    eventHub.disconnectAll();
    try {
      metricsService.flushTrafficToDb();
    } catch {
      // ignore on shutdown
    }
    db.close();
  });

  return {
    app,
    ctx,
    async start() {
      const address = await app.listen({
        host: resolvedConfig.host,
        port: resolvedConfig.port
      });
      const actualPort = app.server.address()?.port ?? resolvedConfig.port;
      const mdnsResult = discoveryService.start(actualPort);

      logService.write({
        level: "info",
        component: "server",
        eventCode: "server.started",
        message: `BitVoid Server listening on ${address} (mode=${resolvedConfig.deploymentMode}/${resolvedConfig.networkMode}, tls=${tlsContext.enabled})`,
        context: {
          serverId,
          address,
          port: actualPort,
          mdns: mdnsResult.started,
          schemaVersion: migrationResult.currentVersion
        }
      });

      return { address, port: actualPort, serverId, mdns: mdnsResult };
    },
    async close() {
      await app.close();
    }
  };
}
