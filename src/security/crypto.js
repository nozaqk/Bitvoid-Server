import {
  createCipheriv,
  createDecipheriv,
  createHash,
  createHmac,
  hkdfSync,
  randomBytes,
  randomUUID,
  timingSafeEqual,
  X509Certificate
} from "node:crypto";

export function nowIso() {
  return new Date().toISOString();
}

export function sha256Hex(value) {
  return createHash("sha256").update(value).digest("hex");
}

export function hmacSha256Hex(key, value) {
  return createHmac("sha256", key).update(value).digest("hex");
}

/**
 * Constant-time equality comparison for strings or Buffers.
 */
export function safeEqual(a, b) {
  const bufA = Buffer.isBuffer(a) ? a : Buffer.from(String(a), "utf8");
  const bufB = Buffer.isBuffer(b) ? b : Buffer.from(String(b), "utf8");
  if (bufA.length !== bufB.length) {
    // Compare against self to keep branch timing uniform while still returning false.
    timingSafeEqual(bufA, bufA);
    return false;
  }
  return timingSafeEqual(bufA, bufB);
}

/**
 * Derive a purpose-separated 32-byte key from a master secret using HKDF-SHA256.
 */
export function deriveSubkey(masterSecret, purpose, salt = "bitvoid-server-v1", length = 32) {
  const derived = hkdfSync(
    "sha256",
    Buffer.from(masterSecret, "utf8"),
    Buffer.from(salt, "utf8"),
    Buffer.from(`bitvoid:${purpose}`, "utf8"),
    length
  );
  return Buffer.from(derived);
}

/**
 * Encrypt UTF-8 text or Buffer with AES-256-GCM and optional Associated Authenticated Data (AAD).
 * Returns versioned compact envelope: "v1:<iv_b64>:<tag_b64>:<ciphertext_b64>"
 */
export function encryptAesGcm(plaintext, key32, aad = "") {
  if (!Buffer.isBuffer(key32) || key32.length !== 32) {
    throw new Error("AES-256-GCM requires a 32-byte key.");
  }
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key32, iv);
  if (aad) {
    cipher.setAAD(Buffer.from(aad, "utf8"));
  }
  const input = Buffer.isBuffer(plaintext) ? plaintext : Buffer.from(String(plaintext), "utf8");
  const encrypted = Buffer.concat([cipher.update(input), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `v1:${iv.toString("base64")}:${tag.toString("base64")}:${encrypted.toString("base64")}`;
}

/**
 * Decrypt AES-256-GCM envelope produced by encryptAesGcm.
 */
export function decryptAesGcm(envelope, key32, aad = "", asBuffer = false) {
  if (!Buffer.isBuffer(key32) || key32.length !== 32) {
    throw new Error("AES-256-GCM requires a 32-byte key.");
  }
  if (typeof envelope !== "string") {
    throw new Error("Invalid encrypted envelope.");
  }
  const parts = envelope.split(":");
  if (parts.length !== 4 || parts[0] !== "v1") {
    throw new Error("Unsupported encrypted envelope format.");
  }
  const iv = Buffer.from(parts[1], "base64");
  const tag = Buffer.from(parts[2], "base64");
  const ciphertext = Buffer.from(parts[3], "base64");
  if (iv.length !== 12 || tag.length !== 16) {
    throw new Error("Corrupted AES-GCM metadata.");
  }
  const decipher = createDecipheriv("aes-256-gcm", key32, iv);
  decipher.setAuthTag(tag);
  if (aad) {
    decipher.setAAD(Buffer.from(aad, "utf8"));
  }
  const decrypted = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  return asBuffer ? decrypted : decrypted.toString("utf8");
}

export function generateOpaqueId(prefix) {
  return `${prefix}_${randomUUID().replaceAll("-", "")}`;
}

export function generateRecoveryKeyHex() {
  // 22 bytes = 176 bits = 44 hex chars (preserves exact compatibility with existing API & Android client)
  return randomBytes(22).toString("hex");
}

export function generateRefreshToken() {
  // 48 random bytes = 384 bits of entropy, base64url encoded
  return `bvr_${randomBytes(48).toString("base64url")}`;
}

export function generateEnrollmentCode() {
  // 16 random bytes formatted in readable uppercase groups for first-run local admin enrollment
  const hex = randomBytes(16).toString("hex").toUpperCase();
  return hex.match(/.{1,4}/g).join("-");
}

/**
 * Extract certificate fingerprint and metadata from a PEM-encoded X.509 certificate.
 */
export function inspectCertificatePem(certPem) {
  const x509 = new X509Certificate(certPem);
  return {
    fingerprint256: x509.fingerprint256,
    subject: x509.subject,
    issuer: x509.issuer,
    validFrom: x509.validFrom,
    validTo: x509.validTo,
    serialNumber: x509.serialNumber,
    subjectAltName: x509.subjectAltName || null
  };
}
