import argon2 from "argon2";
import bcrypt from "bcryptjs";

const BCRYPT_PREFIX_RE = /^\$2[aby]\$\d{2}\$/;
const ARGON2ID_PREFIX = "$argon2id$";

const PRODUCTION_ARGON2_OPTIONS = Object.freeze({
  type: argon2.argon2id,
  memoryCost: 65536, // 64 MiB (OWASP recommended)
  timeCost: 3,
  parallelism: 1,
  hashLength: 32
});

const TEST_ARGON2_OPTIONS = Object.freeze({
  type: argon2.argon2id,
  memoryCost: 8192, // 8 MiB for rapid deterministic test runs
  timeCost: 2,
  parallelism: 1,
  hashLength: 32
});

export function detectPasswordAlgorithm(hash) {
  if (typeof hash !== "string") return "unknown";
  if (hash.startsWith(ARGON2ID_PREFIX)) return "argon2id";
  if (BCRYPT_PREFIX_RE.test(hash)) return "bcrypt";
  return "unknown";
}

export function createPasswordHasher({ fastTestHashing = false } = {}) {
  const options = fastTestHashing ? TEST_ARGON2_OPTIONS : PRODUCTION_ARGON2_OPTIONS;

  return {
    algorithm: "argon2id",

    async hash(password) {
      if (typeof password !== "string" || password.length === 0) {
        throw new Error("Password must be a non-empty string.");
      }
      return argon2.hash(password, options);
    },

    async verify(password, storedHash) {
      if (typeof password !== "string" || typeof storedHash !== "string" || storedHash.length === 0) {
        return { valid: false, algorithm: "unknown", needsRehash: false };
      }

      const algo = detectPasswordAlgorithm(storedHash);
      if (algo === "argon2id") {
        try {
          const valid = await argon2.verify(storedHash, password);
          const needsRehash = valid ? argon2.needsRehash(storedHash, options) : false;
          return { valid, algorithm: "argon2id", needsRehash };
        } catch {
          return { valid: false, algorithm: "argon2id", needsRehash: false };
        }
      }

      if (algo === "bcrypt") {
        // Legacy bcrypt hashes have a 72 UTF-8 byte input limit.
        if (Buffer.byteLength(password, "utf8") > 72) {
          return { valid: false, algorithm: "bcrypt", needsRehash: false };
        }
        try {
          const valid = await bcrypt.compare(password, storedHash);
          return { valid, algorithm: "bcrypt", needsRehash: valid };
        } catch {
          return { valid: false, algorithm: "bcrypt", needsRehash: false };
        }
      }

      return { valid: false, algorithm: "unknown", needsRehash: false };
    }
  };
}
