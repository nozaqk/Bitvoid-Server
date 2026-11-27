import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { randomBytes } from "node:crypto";
import { createServerInstance } from "../../src/app.js";

export async function createTestServer(extraOverrides = {}) {
  const workDir = mkdtempSync(join(tmpdir(), "bitvoid-test-"));
  const secret = randomBytes(48).toString("base64");

  const overrides = {
    BITVOID_TOKEN_SECRET: secret,
    BITVOID_HOST: "127.0.0.1",
    BITVOID_PORT: "0",
    BITVOID_DISPLAY_NAME: "BitVoid Test Server",
    BITVOID_DATA_DIR: workDir,
    BITVOID_DATABASE_PATH: join(workDir, "bitvoid.sqlite"),
    BITVOID_MEDIA_DIR: join(workDir, "media"),
    BITVOID_BACKUP_DIR: join(workDir, "backups"),
    BITVOID_LOG_DIR: join(workDir, "logs"),
    BITVOID_IPC_PATH: process.platform === "win32"
      ? `\\\\.\\pipe\\bitvoid-test-${process.pid}-${randomBytes(8).toString("hex")}`
      : join(workDir, "bitvoid-admin.sock"),
    BITVOID_IPC_ENABLED: "false",
    BITVOID_MDNS_ENABLED: "false",
    BITVOID_LOGGER: "false",
    BITVOID_TEST_FAST_HASH: "true",
    BITVOID_RATE_LIMIT_MAX: "1000",
    BITVOID_AUTH_RATE_LIMIT_MAX: "20",
    ...extraOverrides
  };

  const server = await createServerInstance({ env: {}, overrides });

  return {
    workDir,
    secret,
    server,
    app: server.app,
    ctx: server.ctx,
    async listen() {
      const info = await server.start();
      const baseUrl = `http://127.0.0.1:${info.port}`;
      const wsUrl = `ws://127.0.0.1:${info.port}/api/v1/events`;
      return { ...info, baseUrl, wsUrl };
    },
    async cleanup() {
      await server.close();
      rmSync(workDir, { recursive: true, force: true });
    }
  };
}
