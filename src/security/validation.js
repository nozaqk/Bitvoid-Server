import {
  DEVICE_PLATFORMS,
  DEVICE_TRUST_STATUSES,
  LIMITS,
  NODE_STATUSES
} from "../config/constants.js";

export function isValidUsername(value) {
  return (
    typeof value === "string" &&
    value.length >= LIMITS.USERNAME_MIN &&
    value.length <= LIMITS.USERNAME_MAX &&
    /^[a-zA-Z0-9._-]+$/.test(value)
  );
}

export function normalizeUsername(value) {
  return value.trim().toLowerCase();
}

export function isValidPassword(value) {
  return (
    typeof value === "string" &&
    value.length >= LIMITS.PASSWORD_MIN &&
    value.length <= LIMITS.PASSWORD_MAX
  );
}

export function isValidRecoveryKey(value) {
  return (
    typeof value === "string" &&
    value.length === LIMITS.RECOVERY_HEX_LENGTH &&
    /^[0-9a-fA-F]{44}$/.test(value)
  );
}

export function isValidDisplayName(value) {
  if (typeof value !== "string") return false;
  const trimmed = value.trim();
  return trimmed.length >= 1 && trimmed.length <= LIMITS.DISPLAY_NAME_MAX;
}

export function isValidOpaqueId(value, prefix = null) {
  if (typeof value !== "string" || value.length < 4 || value.length > 80) return false;
  if (!/^[a-zA-Z0-9_-]+$/.test(value)) return false;
  if (prefix && !value.startsWith(`${prefix}_`)) return false;
  return true;
}

export function isValidNodeStatus(value) {
  return typeof value === "string" && NODE_STATUSES.includes(value);
}

export function isValidDeviceTrustStatus(value) {
  return typeof value === "string" && DEVICE_TRUST_STATUSES.includes(value);
}

export function normalizeDevicePlatform(value) {
  if (typeof value !== "string") return "unknown";
  const normalized = value.trim().toLowerCase();
  return DEVICE_PLATFORMS.includes(normalized) ? normalized : "unknown";
}

export function sanitizeDeviceName(value, fallback = "Unknown Device") {
  if (typeof value !== "string") return fallback;
  const cleaned = value.replace(/[\u0000-\u001F\u007F]/g, "").trim();
  if (!cleaned) return fallback;
  return cleaned.slice(0, LIMITS.DEVICE_NAME_MAX);
}

/**
 * Sanitize an uploaded filename to eliminate directory traversal, null bytes, and control chars.
 */
export function sanitizeFilename(name, fallback = "attachment.bin") {
  if (typeof name !== "string") return fallback;
  const base = name
    .replace(/\\/g, "/")
    .split("/")
    .pop()
    .replace(/[\u0000-\u001F\u007F<>:"|?*]/g, "")
    .replace(/^\.+/, "")
    .trim();
  if (!base) return fallback;
  return base.slice(0, 180);
}

export function parsePageLimit(value, fallback = LIMITS.DEFAULT_PAGE_LIMIT) {
  if (value === undefined || value === null || value === "") return fallback;
  const parsed = Number.parseInt(String(value), 10);
  if (!Number.isInteger(parsed) || parsed < 1) return fallback;
  return Math.min(parsed, LIMITS.MAX_PAGE_LIMIT);
}
