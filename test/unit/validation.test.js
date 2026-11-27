import test from "node:test";
import assert from "node:assert/strict";
import {
  isValidPassword,
  isValidRecoveryKey,
  isValidUsername,
  sanitizeFilename
} from "../../src/security/validation.js";

test("Username, password, and recovery key validators enforce contract rules", () => {
  assert.equal(isValidUsername("alice"), true);
  assert.equal(isValidUsername("node_01.test-a"), true);
  assert.equal(isValidUsername("a"), false);
  assert.equal(isValidUsername("bad user"), false);
  assert.equal(isValidUsername("drop;table"), false);

  assert.equal(isValidPassword("short9999"), false);
  assert.equal(isValidPassword("ValidPass123!"), true);
  assert.equal(isValidPassword("x".repeat(129)), false);

  assert.equal(isValidRecoveryKey("a".repeat(44)), true);
  assert.equal(isValidRecoveryKey("ABCDEF0123456789".repeat(2) + "abcdef012345"), true);
  assert.equal(isValidRecoveryKey("z".repeat(44)), false);
  assert.equal(isValidRecoveryKey("a".repeat(43)), false);
});

test("sanitizeFilename neutralizes path traversal, backslashes, and control characters", () => {
  assert.equal(sanitizeFilename("../../etc/passwd"), "passwd");
  assert.equal(sanitizeFilename("..\\..\\windows\\system32\\cmd.exe"), "cmd.exe");
  assert.equal(sanitizeFilename("report\u0000.pdf"), "report.pdf");
  assert.equal(sanitizeFilename("...hidden"), "hidden");
  assert.equal(sanitizeFilename("///"), "attachment.bin");
  assert.equal(sanitizeFilename("lecture-notes_01.pdf"), "lecture-notes_01.pdf");
});
