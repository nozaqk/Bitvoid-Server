import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import Database from "better-sqlite3";
import { createTestServer } from "../helpers/testContext.js";

test("Consistent online WAL backup, AES-256-GCM encrypted backup, verification, tamper detection, and full restore", async () => {
  const env = await createTestServer();
  const restoreDir = mkdtempSync(join(tmpdir(), "bitvoid-restore-"));
  try {
    const { baseUrl } = await env.listen();

    // Populate live accounts and a media file while server is running in WAL mode.
    const reg = await (
      await fetch(`${baseUrl}/api/v1/account/register`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ username: "backupuser", password: "BackupPassword!123" })
      })
    ).json();
    assert.ok(reg.account.id);

    mkdirSync(join(env.ctx.config.mediaDir, "sample"), { recursive: true });
    writeFileSync(join(env.ctx.config.mediaDir, "sample", "note.txt"), "bitvoid media payload");

    // 1. Create & verify encrypted backup
    const passphrase = "VeryStrongBackupPassphrase#2026";
    const created = await env.ctx.backupService.createBackup({
      createdBy: "adm_test",
      passphrase
    });
    assert.equal(created.encrypted, true);
    assert.equal(created.mediaFileCount, 1);
    assert.ok(existsSync(created.filePath));

    // Confirm raw backup file does NOT leak plaintext username or media text
    const rawFile = readFileSync(created.filePath, "utf8");
    assert.ok(!rawFile.includes("backupuser"));
    assert.ok(!rawFile.includes("bitvoid media payload"));

    // Wrong passphrase must fail verification
    assert.throws(
      () => env.ctx.backupService.verifyBackup(created.id, { passphrase: "WrongPassphrase123!" }),
      "Wrong backup passphrase must throw"
    );

    // Correct passphrase passes full checksum + SQLite integrity + FK check
    const verified = env.ctx.backupService.verifyBackup(created.id, { passphrase });
    assert.equal(verified.ok, true);
    assert.equal(verified.accountCount, 1);
    assert.equal(verified.verifiedMediaFiles, 1);
    assert.equal(verified.integrity.ok, true);

    // 2. Restore backup to an independent target directory
    const targetDb = join(restoreDir, "restored.sqlite");
    const targetMedia = join(restoreDir, "media");
    const restored = env.ctx.backupService.restoreBackupToTarget(created.id, {
      targetDbPath: targetDb,
      targetMediaDir: targetMedia,
      passphrase
    });
    assert.equal(restored.ok, true);
    assert.equal(restored.accountCount, 1);
    assert.equal(restored.restoredMediaCount, 1);

    // Verify restored SQLite DB and media file contents directly
    const rdb = new Database(targetDb, { readonly: true });
    try {
      const row = rdb.prepare("SELECT id, username FROM accounts WHERE username = 'backupuser'").get();
      assert.equal(row.id, reg.account.id);
    } finally {
      rdb.close();
    }
    assert.equal(
      readFileSync(join(targetMedia, "sample", "note.txt"), "utf8"),
      "bitvoid media payload"
    );

    // 3. Tampering with backup archive file on disk must fail verification
    writeFileSync(created.filePath, `${rawFile}\n `, "utf8");
    assert.throws(
      () => env.ctx.backupService.verifyBackup(created.id, { passphrase }),
      /SHA-256 digest/i
    );
  } finally {
    rmSync(restoreDir, { recursive: true, force: true });
    await env.cleanup();
  }
});
