import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createTestServer } from "../helpers/testContext.js";

test("CLI migration, CLI backup/verify, trust-bundle endpoint, and release checksum generator work end-to-end", async () => {
  const dir = mkdtempSync(join(tmpdir(), "bitvoid-cli-"));
  try {
    const dbPath = join(dir, "cli.sqlite");
    const envVars = {
      ...process.env,
      BITVOID_DATABASE_PATH: dbPath,
      BITVOID_DATA_DIR: dir,
      BITVOID_BACKUP_DIR: join(dir, "backups"),
      BITVOID_MEDIA_DIR: join(dir, "media"),
      BITVOID_BACKUP_PASSPHRASE: "CliTestBackupPassphrase#2026"
    };

    // 1. bin/bitvoid-migrate.js up & status
    const migOut = JSON.parse(
      execFileSync(process.execPath, ["bin/bitvoid-migrate.js", "up"], { env: envVars, encoding: "utf8" })
    );
    assert.equal(migOut.integrity.ok, true);
    assert.equal(migOut.migrated.applied.length, 4);

    // 2. bin/bitvoid-backup.js create & verify
    const bkpCreate = JSON.parse(
      execFileSync(process.execPath, ["bin/bitvoid-backup.js", "create"], { env: envVars, encoding: "utf8" })
    );
    assert.equal(bkpCreate.encrypted, true);

    const bkpVerify = JSON.parse(
      execFileSync(process.execPath, ["bin/bitvoid-backup.js", "verify", bkpCreate.id], { env: envVars, encoding: "utf8" })
    );
    assert.equal(bkpVerify.ok, true);

    // 3. scripts/generate-checksums.js
    const distDir = join(dir, "dist");
    const artDir = join(distDir, "sub");
    execFileSync("mkdir", ["-p", artDir]);
    writeFileSync(join(distDir, "bitvoid-server_1.1.0_amd64.deb"), "fake-deb-content");
    writeFileSync(join(artDir, "BitVoid-Server-1.1.0-windows-x64-setup.exe"), "fake-exe-content");

    execFileSync(process.execPath, ["scripts/generate-checksums.js", distDir, "1.1.0"], { encoding: "utf8" });
    assert.ok(existsSync(join(distDir, "SHA256SUMS.txt")));
    assert.ok(existsSync(join(distDir, "release-manifest.json")));

    const manifest = JSON.parse(readFileSync(join(distDir, "release-manifest.json"), "utf8"));
    assert.equal(manifest.version, "1.1.0");
    assert.equal(manifest.artifacts.length, 2);

    // 4. GET /api/v1/server/trust-bundle returns public secret-free trust profile
    const srv = await createTestServer();
    try {
      const { baseUrl, serverId } = await srv.listen();
      const tbRes = await fetch(`${baseUrl}/api/v1/server/trust-bundle`);
      assert.equal(tbRes.status, 200);
      const tb = await tbRes.json();
      assert.equal(tb.data.profile.schema, "bitvoid-server-profile-v1");
      assert.equal(tb.data.profile.serverId, serverId);
      assert.ok(Array.isArray(tb.data.lanEndpoints));
    } finally {
      await srv.cleanup();
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
