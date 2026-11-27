export const SERVER_VERSION = "1.1.0";
export const API_VERSION = "1.1.0";
export const API_PREFIX = "/api/v1";
export const EVENT_PROTOCOL_VERSION = 1;
export const JWT_ISSUER = "bitvoid-server";
export const JWT_AUDIENCE = "bitvoid-app";
export const ADMIN_JWT_ISSUER = "bitvoid-server-admin";
export const ADMIN_JWT_AUDIENCE = "bitvoid-desktop-dashboard";

export const DEPLOYMENT_MODES = Object.freeze(["self-hosted", "centrally-hosted"]);
export const NETWORK_MODES = Object.freeze(["lan", "hotspot", "vpn"]);

export const NODE_STATUSES = Object.freeze(["active", "suspended", "disabled"]);
export const DEVICE_TRUST_STATUSES = Object.freeze(["trusted", "pending", "revoked"]);
export const DEVICE_PLATFORMS = Object.freeze(["android", "windows", "linux", "macos", "ios", "unknown"]);

export const WS_CLOSE_CODES = Object.freeze({
  NORMAL: 1000,
  INVALID_DATA: 1003,
  POLICY_VIOLATION: 1008,
  SESSION_REVOKED: 4001,
  SESSION_EXPIRED: 4002,
  DEVICE_REVOKED: 4003,
  NODE_SUSPENDED: 4004,
  SERVER_SHUTDOWN: 4005
});

export const LIMITS = Object.freeze({
  USERNAME_MIN: 2,
  USERNAME_MAX: 24,
  DISPLAY_NAME_MAX: 64,
  PASSWORD_MIN: 10,
  PASSWORD_MAX: 128,
  BCRYPT_MAX_BYTES: 72,
  RECOVERY_HEX_LENGTH: 44,
  DEVICE_NAME_MAX: 80,
  MESSAGE_BODY_MAX: 8192,
  CONVERSATION_TITLE_MAX: 100,
  CHANNEL_NAME_MAX: 80,
  CHANNEL_DESC_MAX: 500,
  CLASS_TITLE_MAX: 120,
  SIGNAL_PAYLOAD_MAX: 32768,
  DEFAULT_PAGE_LIMIT: 50,
  MAX_PAGE_LIMIT: 200,
  JSON_BODY_LIMIT: 131072, // 128 KiB
  DEFAULT_MAX_UPLOAD_BYTES: 25 * 1024 * 1024, // 25 MiB
  DEFAULT_NODE_STORAGE_QUOTA_BYTES: 512 * 1024 * 1024 // 512 MiB
});

export const MDNS_CONFIG = Object.freeze({
  PRIMARY_SERVICE_TYPE: "bitvoid-server",
  COMPAT_SERVICE_TYPE: "http",
  DEFAULT_INSTANCE_NAME: "BitVoid Server"
});
