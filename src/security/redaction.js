const SENSITIVE_KEYS = new Set([
  "authorization",
  "cookie",
  "set-cookie",
  "password",
  "newpassword",
  "currentpassword",
  "passwordhash",
  "password_hash",
  "masterpassphrase",
  "recoverykey",
  "recovery_hash",
  "token",
  "refreshtoken",
  "refresh_token",
  "accesstoken",
  "secret",
  "tokensecret",
  "privatekey",
  "enrollmentcode",
  "passphrase",
  "body",
  "content",
  "sdp"
]);

export const FASTIFY_REDACT_PATHS = [
  "req.headers.authorization",
  "req.headers.cookie",
  'req.headers["x-admin-token"]',
  "res.headers[\"set-cookie\"]",
  "body.password",
  "body.newPassword",
  "body.currentPassword",
  "body.masterPassphrase",
  "body.token",
  "body.refreshToken",
  "body.secret",
  "body.passphrase",
  "body.body",
  "body.content"
];

/**
 * Recursively scrub sensitive keys and bearer/JWT/recovery-key patterns before writing logs or audit details.
 */
export function redactValue(value, depth = 0) {
  if (depth > 8) return "[MAX_DEPTH]";
  if (value === null || value === undefined) return value;

  if (typeof value === "string") {
    let scrubbed = value;
    scrubbed = scrubbed.replace(/Bearer\s+[A-Za-z0-9\-_]+\.[A-Za-z0-9\-_]+\.[A-Za-z0-9\-_]+/gi, "Bearer [REDACTED]");
    scrubbed = scrubbed.replace(/\beyJ[A-Za-z0-9\-_]+\.[A-Za-z0-9\-_]+\.[A-Za-z0-9\-_]+\b/g, "[REDACTED_JWT]");
    scrubbed = scrubbed.replace(/\bbvr_[A-Za-z0-9\-_]{16,}\b/g, "[REDACTED_REFRESH]");
    return scrubbed;
  }

  if (Array.isArray(value)) {
    return value.map((item) => redactValue(item, depth + 1));
  }

  if (typeof value === "object") {
    const out = {};
    for (const [key, val] of Object.entries(value)) {
      if (SENSITIVE_KEYS.has(key.toLowerCase())) {
        out[key] = "[REDACTED]";
      } else {
        out[key] = redactValue(val, depth + 1);
      }
    }
    return out;
  }

  return value;
}
