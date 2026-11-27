import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { resolveProtectedEnvFile, loadProtectedEnv } from "../../src/config/protectedEnv.js";

test("Windows resolves server.env inside the protected ProgramData directory", () => {
  assert.equal(
    resolveProtectedEnvFile({ ProgramData: "C:\\ProgramData" }, "win32"),
    "C:\\ProgramData\\BitVoidServer\\server.env"
  );
});

test("Windows falls back to the default ProgramData location when the variable is missing", () => {
  assert.equal(resolveProtectedEnvFile({}, "win32"), "C:\\ProgramData\\BitVoidServer\\server.env");
});

test("an explicit DOTENV_CONFIG_PATH or BITVOID_ENV_FILE takes precedence", () => {
  assert.equal(resolveProtectedEnvFile({ DOTENV_CONFIG_PATH: "/x/a.env" }, "linux"), "/x/a.env");
  assert.equal(resolveProtectedEnvFile({ BITVOID_ENV_FILE: "/x/b.env" }, "linux"), "/x/b.env");
});

test("Linux and macOS return no protected file (systemd or launchd supplies the variables)", () => {
  assert.equal(resolveProtectedEnvFile({}, "linux"), null);
  assert.equal(resolveProtectedEnvFile({}, "darwin"), null);
});

test("loadProtectedEnv loads CRLF env files and never overrides existing variables", () => {
  const dir = mkdtempSync(join(tmpdir(), "bv-env-"));
  const file = join(dir, "server.env");
  writeFileSync(file, "BV_TEST_SECRET=from-file-value-xxxxxxxxxxxxxxxxxxxxxxxx\r\nBV_TEST_NAME=BitVoid Local Server\r\n");
  try {
    const env = { DOTENV_CONFIG_PATH: file, BV_TEST_NAME: "explicit" };
    const before = process.env.BV_TEST_SECRET;
    delete process.env.BV_TEST_SECRET;
    const result = loadProtectedEnv(env, "linux");
    assert.equal(result.loaded, true);
    assert.equal(process.env.BV_TEST_SECRET, "from-file-value-xxxxxxxxxxxxxxxxxxxxxxxx");
    assert.equal(process.env.BV_TEST_NAME, "BitVoid Local Server");
    if (before !== undefined) process.env.BV_TEST_SECRET = before;
    delete process.env.BV_TEST_SECRET;
    delete process.env.BV_TEST_NAME;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("loadProtectedEnv reports a missing file without failing startup", () => {
  const result = loadProtectedEnv({ DOTENV_CONFIG_PATH: "/nonexistent/server.env" }, "linux");
  assert.deepEqual(result, { path: "/nonexistent/server.env", exists: false, loaded: false, error: "file not found" });
});
