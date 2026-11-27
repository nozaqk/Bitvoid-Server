import test from "node:test";
import assert from "node:assert/strict";
import bcrypt from "bcryptjs";
import { createPasswordHasher, detectPasswordAlgorithm } from "../../src/security/passwords.js";

test("Argon2id hashes new passwords and verifies them", async () => {
  const hasher = createPasswordHasher({ fastTestHashing: true });
  const hash = await hasher.hash("SuperSecurePassphrase!2026");

  assert.ok(hash.startsWith("$argon2id$"), "Hash must use Argon2id");
  assert.equal(detectPasswordAlgorithm(hash), "argon2id");

  const ok = await hasher.verify("SuperSecurePassphrase!2026", hash);
  assert.equal(ok.valid, true);
  assert.equal(ok.algorithm, "argon2id");
  assert.equal(ok.needsRehash, false);

  const bad = await hasher.verify("WrongPassword!2026", hash);
  assert.equal(bad.valid, false);
});

test("Argon2id supports passwords longer than 72 bytes without truncation", async () => {
  const hasher = createPasswordHasher({ fastTestHashing: true });
  const prefix = "a".repeat(80);
  const hash = await hasher.hash(`${prefix}1`);

  const match = await hasher.verify(`${prefix}1`, hash);
  const diffTail = await hasher.verify(`${prefix}2`, hash);

  assert.equal(match.valid, true);
  assert.equal(diffTail.valid, false);
});

test("Legacy bcrypt hashes verify cleanly and signal needsRehash=true", async () => {
  const hasher = createPasswordHasher({ fastTestHashing: true });
  const legacyHash = await bcrypt.hash("LegacyUserPass123!", 10);

  assert.equal(detectPasswordAlgorithm(legacyHash), "bcrypt");

  const ok = await hasher.verify("LegacyUserPass123!", legacyHash);
  assert.equal(ok.valid, true);
  assert.equal(ok.algorithm, "bcrypt");
  assert.equal(ok.needsRehash, true);

  const bad = await hasher.verify("NotTheLegacyPassword", legacyHash);
  assert.equal(bad.valid, false);
  assert.equal(bad.needsRehash, false);
});
