import { dirname, join, resolve } from "node:path";
import { homedir, platform } from "node:os";
import { DEPLOYMENT_MODES, LIMITS, NETWORK_MODES } from "./constants.js";

/**
 * Resolve OS-appropriate default data directory when BITVOID_USE_OS_DATA_DIR=true.
 * In development / repository checkouts, defaults to `./data` to preserve existing behavior.
 */
export function resolveDefaultDataDir(env = process.env) {
  if (env.BITVOID_DATA_DIR) {
    return resolve(env.BITVOID_DATA_DIR);
  }
  if (env.BITVOID_USE_OS_DATA_DIR === "true") {
    const os = platform();
    if (os === "win32") {
      const base = env.PROGRAMDATA || env.LOCALAPPDATA || homedir();
      return resolve(base, "BitVoidServer");
    }
    if (os === "darwin") {
      return resolve(homedir(), "Library", "Application Support", "BitVoidServer");
    }
    const xdg = env.XDG_DATA_HOME || join(homedir(), ".local", "share");
    return resolve(xdg, "bitvoid-server");
  }
  return resolve("./data");
}

/**
 * Resolve platform-native protected local IPC endpoint for desktop administration.
 * Windows: Named pipe. Linux/macOS: Unix domain socket inside the data directory.
 */
export function resolveDefaultIpcPath(dataDir, env = process.env) {
  if (env.BITVOID_IPC_PATH && env.BITVOID_IPC_PATH.trim().length > 0) {
    return env.BITVOID_IPC_PATH.trim();
  }
  if (platform() === "win32") {
    return "\\\\.\\pipe\\bitvoid-server-admin";
  }
  return join(dataDir, "bitvoid-admin.sock");
}

/**
 * Parse a duration string like "15m", "1h", "7d", "30d", or integer seconds into milliseconds.
 */
export function parseDurationMs(value, fallbackMs) {
  if (typeof value === "number" && Number.isFinite(value) && value > 0) {
    return Math.floor(value * 1000);
  }
  if (typeof value !== "string" || value.trim() === "") {
    return fallbackMs;
  }
  const trimmed = value.trim();
  if (/^\d+$/.test(trimmed)) {
    return Number.parseInt(trimmed, 10) * 1000;
  }
  const match = /^(\d+)\s*(ms|s|m|h|d)$/i.exec(trimmed);
  if (!match) {
    throw new Error(`Invalid duration format: "${value}". Use formats like 15m, 1h, 7d, 30d.`);
  }
  const amount = Number.parseInt(match[1], 10);
  const unit = match[2].toLowerCase();
  const multipliers = {
    ms: 1,
    s: 1000,
    m: 60 * 1000,
    h: 60 * 60 * 1000,
    d: 24 * 60 * 60 * 1000
  };
  return amount * multipliers[unit];
}

function parseUnixMode(value, fallback, name) {
  if (value === undefined || value === null || value === "") return fallback;
  const raw = String(value).trim();
  if (!/^(?:0?[0-7]{3})$/.test(raw)) {
    throw new Error(`Invalid ${name}. Use a three-digit octal permission mode such as 0600 or 0660.`);
  }
  return Number.parseInt(raw, 8);
}

function parseBoolean(value, defaultValue) {
  if (value === undefined || value === null || value === "") return defaultValue;
  if (typeof value === "boolean") return value;
  const normalized = String(value).trim().toLowerCase();
  if (["1", "true", "yes", "on"].includes(normalized)) return true;
  if (["0", "false", "no", "off"].includes(normalized)) return false;
  return defaultValue;
}

/**
 * Load and strictly validate Server configuration from an environment object or explicit overrides.
 */
export function loadConfig(env = process.env, overrides = {}) {
  const merged = { ...env, ...overrides };

  const port = Number.parseInt(String(merged.BITVOID_PORT ?? "8787"), 10);
  if (!Number.isInteger(port) || port < 0 || port > 65535) {
    throw new Error("Invalid BITVOID_PORT. Must be an integer between 0 and 65535.");
  }

  const tokenSecret = String(merged.BITVOID_TOKEN_SECRET ?? "");
  if (
    tokenSecret.length < 32 ||
    tokenSecret.includes("replace-with-a-long-random-secret")
  ) {
    throw new Error(
      "Set BITVOID_TOKEN_SECRET to a unique random secret of at least 32 characters."
    );
  }

  const host = String(merged.BITVOID_HOST || "0.0.0.0").trim();
  const displayName = String(merged.BITVOID_DISPLAY_NAME || "AirMesh Local Server").trim();

  const dataDir = resolveDefaultDataDir(merged);
  const databasePath = merged.BITVOID_DATABASE_PATH
    ? resolve(String(merged.BITVOID_DATABASE_PATH))
    : join(dataDir, "bitvoid.sqlite");
  const effectiveDataDir = merged.BITVOID_DATA_DIR
    ? resolve(String(merged.BITVOID_DATA_DIR))
    : dirname(databasePath);

  const mediaDir = merged.BITVOID_MEDIA_DIR
    ? resolve(String(merged.BITVOID_MEDIA_DIR))
    : join(effectiveDataDir, "media");
  const backupDir = merged.BITVOID_BACKUP_DIR
    ? resolve(String(merged.BITVOID_BACKUP_DIR))
    : join(effectiveDataDir, "backups");
  const logDir = merged.BITVOID_LOG_DIR
    ? resolve(String(merged.BITVOID_LOG_DIR))
    : join(effectiveDataDir, "logs");

  const ipcPath = resolveDefaultIpcPath(effectiveDataDir, merged);
  const ipcSocketMode = parseUnixMode(merged.BITVOID_IPC_SOCKET_MODE, 0o600, "BITVOID_IPC_SOCKET_MODE");
  if (![0o600, 0o660].includes(ipcSocketMode)) {
    throw new Error("BITVOID_IPC_SOCKET_MODE must be 0600 or 0660.");
  }
  const enrollmentFileMode = parseUnixMode(
    merged.BITVOID_ENROLLMENT_FILE_MODE,
    0o600,
    "BITVOID_ENROLLMENT_FILE_MODE"
  );
  if (![0o600, 0o640].includes(enrollmentFileMode)) {
    throw new Error("BITVOID_ENROLLMENT_FILE_MODE must be 0600 or 0640.");
  }

  const deploymentMode = String(merged.BITVOID_DEPLOYMENT_MODE || "self-hosted").trim().toLowerCase();
  if (!DEPLOYMENT_MODES.includes(deploymentMode)) {
    throw new Error(`Invalid BITVOID_DEPLOYMENT_MODE "${deploymentMode}". Expected one of: ${DEPLOYMENT_MODES.join(", ")}`);
  }

  const networkMode = String(merged.BITVOID_NETWORK_MODE || "lan").trim().toLowerCase();
  if (!NETWORK_MODES.includes(networkMode)) {
    throw new Error(`Invalid BITVOID_NETWORK_MODE "${networkMode}". Expected one of: ${NETWORK_MODES.join(", ")}`);
  }

  const tokenTtl = String(merged.BITVOID_TOKEN_TTL || "7d").trim();
  const tokenTtlMs = parseDurationMs(tokenTtl, 7 * 24 * 60 * 60 * 1000);

  const refreshTtl = String(merged.BITVOID_REFRESH_TTL || "30d").trim();
  const refreshTtlMs = parseDurationMs(refreshTtl, 30 * 24 * 60 * 60 * 1000);

  const maxUploadBytes = Number.parseInt(
    String(merged.BITVOID_MAX_UPLOAD_BYTES ?? LIMITS.DEFAULT_MAX_UPLOAD_BYTES),
    10
  );
  if (!Number.isInteger(maxUploadBytes) || maxUploadBytes < 1024 || maxUploadBytes > 512 * 1024 * 1024) {
    throw new Error("Invalid BITVOID_MAX_UPLOAD_BYTES. Must be between 1024 and 536870912 bytes.");
  }

  const tlsCert = merged.BITVOID_TLS_CERT ? resolve(String(merged.BITVOID_TLS_CERT)) : "";
  const tlsKey = merged.BITVOID_TLS_KEY ? resolve(String(merged.BITVOID_TLS_KEY)) : "";
  const tlsCa = merged.BITVOID_TLS_CA ? resolve(String(merged.BITVOID_TLS_CA)) : "";
  if ((tlsCert && !tlsKey) || (!tlsCert && tlsKey)) {
    throw new Error("Both BITVOID_TLS_CERT and BITVOID_TLS_KEY must be provided together.");
  }

  const mdnsEnabled = parseBoolean(merged.BITVOID_MDNS_ENABLED, networkMode !== "vpn");
  const trustProxy = parseBoolean(merged.BITVOID_TRUST_PROXY, false);
  const ipcEnabled = parseBoolean(merged.BITVOID_IPC_ENABLED, true);
  const loggerEnabled = parseBoolean(merged.BITVOID_LOGGER, true);
  const logLevel = String(merged.BITVOID_LOG_LEVEL || "info").trim();
  const fastTestHashing = parseBoolean(merged.BITVOID_TEST_FAST_HASH, false);

  const rateLimitMax = Number.parseInt(String(merged.BITVOID_RATE_LIMIT_MAX ?? "180"), 10);
  const authRateLimitMax = Number.parseInt(String(merged.BITVOID_AUTH_RATE_LIMIT_MAX ?? "8"), 10);

  return Object.freeze({
    host,
    port,
    tokenSecret,
    displayName,
    deploymentMode,
    networkMode,
    dataDir: effectiveDataDir,
    databasePath,
    mediaDir,
    backupDir,
    logDir,
    ipcPath,
    ipcSocketMode,
    enrollmentFileMode,
    ipcEnabled,
    tokenTtl,
    tokenTtlMs,
    refreshTtl,
    refreshTtlMs,
    maxUploadBytes,
    nodeStorageQuotaBytes: Number.parseInt(
      String(merged.BITVOID_NODE_STORAGE_QUOTA_BYTES ?? LIMITS.DEFAULT_NODE_STORAGE_QUOTA_BYTES),
      10
    ),
    tls: {
      enabled: Boolean(tlsCert && tlsKey),
      certPath: tlsCert,
      keyPath: tlsKey,
      caPath: tlsCa
    },
    mdnsEnabled,
    trustProxy,
    loggerEnabled,
    logLevel,
    fastTestHashing,
    rateLimitMax: Number.isInteger(rateLimitMax) && rateLimitMax > 0 ? rateLimitMax : 180,
    authRateLimitMax: Number.isInteger(authRateLimitMax) && authRateLimitMax > 0 ? authRateLimitMax : 8
  });
}
