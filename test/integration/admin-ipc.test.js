import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync, statSync } from "node:fs";
import { createTestServer } from "../helpers/testContext.js";
import { sendAdminIpcRequest } from "../../src/ipc/adminIpcClient.js";

test("Protected local IPC administration: owner-only socket permissions, first-run enrollment, token separation, and all dashboard controls", async () => {
  const env = await createTestServer({ BITVOID_IPC_ENABLED: "true" });
  try {
    const info = await env.listen();
    const ipcPath = info.ipc.ipcPath;
    assert.equal(info.ipc.enabled, true);
    assert.ok(existsSync(ipcPath));

    // 1. Verify Unix socket permissions are strictly owner-only (0600)
    if (process.platform !== "win32") {
      const mode = statSync(ipcPath).mode & 0o777;
      assert.equal(mode, 0o600, "Admin IPC Unix socket must be chmod 0600");
    }

    // 2. Check initial status -> first-run enrollment required, NO default admin password!
    const status0 = await sendAdminIpcRequest({ ipcPath, method: "admin.status" });
    assert.equal(status0.initialized, false);
    assert.equal(status0.enrollmentRequired, true);
    assert.ok(existsSync(status0.enrollmentFilePath));

    // Unauthenticated management call must fail
    await assert.rejects(
      () => sendAdminIpcRequest({ ipcPath, method: "overview.get" }),
      /authentication is required/i
    );

    // Register a regular Node and verify its JWT CANNOT authenticate to the Admin IPC!
    const nodeReg = await (
      await fetch(`${info.baseUrl}/api/v1/account/register`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          username: "managed_node",
          password: "ManagedNodePassword!123",
          device: { displayName: "Android Phone", platform: "android" }
        })
      })
    ).json();

    await assert.rejects(
      () =>
        sendAdminIpcRequest({
          ipcPath,
          method: "overview.get",
          authToken: nodeReg.token
        }),
      /invalid or expired administrator session/i
    );

    // 3. Complete first-run setup with one-time enrollment code from local 0600 file
    const enrollmentText = readFileSync(status0.enrollmentFilePath, "utf8");
    const match = /ENROLLMENT_CODE=([A-Z0-9-]+)/.exec(enrollmentText);
    assert.ok(match, "Enrollment file must contain ENROLLMENT_CODE");
    const enrollmentCode = match[1];

    // Wrong code fails
    await assert.rejects(
      () =>
        sendAdminIpcRequest({
          ipcPath,
          method: "admin.setup",
          params: {
            enrollmentCode: "0000-0000-0000-0000-0000-0000-0000-0000",
            username: "serveradmin",
            password: "AdminStrongPassword!2026"
          }
        }),
      /invalid or expired/i
    );

    // Valid code creates owner administrator and deletes enrollment file automatically
    const setupRes = await sendAdminIpcRequest({
      ipcPath,
      method: "admin.setup",
      params: {
        enrollmentCode,
        username: "serveradmin",
        password: "AdminStrongPassword!2026"
      }
    });
    assert.equal(setupRes.admin.username, "serveradmin");
    assert.equal(setupRes.admin.role, "owner");
    assert.ok(setupRes.token);
    assert.equal(existsSync(status0.enrollmentFilePath), false, "Enrollment file must be deleted after setup");

    const adminToken = setupRes.token;

    // 4. Exercise all 10 Dashboard domains over local IPC
    const overview = await sendAdminIpcRequest({ ipcPath, method: "overview.get", authToken: adminToken });
    assert.equal(overview.server.serverId, info.serverId);
    assert.equal(overview.metrics.nodes.total, 1);

    const nodesRes = await sendAdminIpcRequest({ ipcPath, method: "nodes.list", authToken: adminToken });
    assert.equal(nodesRes.nodes.length, 1);
    assert.equal(nodesRes.nodes[0].username, "managed_node");

    const devicesRes = await sendAdminIpcRequest({ ipcPath, method: "devices.list", authToken: adminToken });
    assert.equal(devicesRes.devices.length, 1);

    const sessionsRes = await sendAdminIpcRequest({ ipcPath, method: "sessions.list", authToken: adminToken });
    assert.equal(sessionsRes.sessions.length, 1);

    // Suspend Node through Admin IPC -> revokes its sessions
    const suspendRes = await sendAdminIpcRequest({
      ipcPath,
      method: "nodes.setStatus",
      authToken: adminToken,
      params: { nodeId: nodeReg.account.id, status: "suspended", reason: "audit_check" }
    });
    assert.equal(suspendRes.node.status, "suspended");
    assert.equal(suspendRes.revokedSessions, 1);

    // Network overview & VPN profile creation
    const netRes = await sendAdminIpcRequest({ ipcPath, method: "network.overview", authToken: adminToken });
    assert.ok(netRes.interfaces);
    assert.equal(typeof netRes.hotspot.capability.supported, "boolean");

    const vpnRes = await sendAdminIpcRequest({
      ipcPath,
      method: "network.vpn.create",
      authToken: adminToken,
      params: { name: "HQ WireGuard", provider: "wireguard", endpointHost: "10.90.0.1", endpointPort: 8787 }
    });
    assert.equal(vpnRes.profile.name, "HQ WireGuard");

    // Logs, audit, security
    const logsRes = await sendAdminIpcRequest({ ipcPath, method: "logs.query", authToken: adminToken });
    assert.ok(Array.isArray(logsRes.entries));

    const auditRes = await sendAdminIpcRequest({ ipcPath, method: "audit.query", authToken: adminToken });
    assert.ok(auditRes.events.some((e) => e.action === "admin.setup"));

    const secRes = await sendAdminIpcRequest({ ipcPath, method: "security.overview", authToken: adminToken });
    assert.equal(secRes.adminSessions.length, 1);

    // Backups & Database
    const bkpCreate = await sendAdminIpcRequest({
      ipcPath,
      method: "backups.create",
      authToken: adminToken,
      params: { passphrase: "AdminBackupPassphrase#2026" }
    });
    assert.equal(bkpCreate.backup.encrypted, true);

    const bkpVerify = await sendAdminIpcRequest({
      ipcPath,
      method: "backups.verify",
      authToken: adminToken,
      params: { backupId: bkpCreate.backup.id, passphrase: "AdminBackupPassphrase#2026" }
    });
    assert.equal(bkpVerify.ok, true);

    const dbStatus = await sendAdminIpcRequest({ ipcPath, method: "database.status", authToken: adminToken });
    assert.equal(dbStatus.integrity.ok, true);
    assert.equal(dbStatus.migrations.pendingCount, 0);

    // Encrypted config & updates
    const setCfg = await sendAdminIpcRequest({
      ipcPath,
      method: "config.setEncrypted",
      authToken: adminToken,
      params: { key: "relay.turn.secret", value: "encrypted-turn-credential" }
    });
    assert.equal(setCfg.saved, true);

    const upd = await sendAdminIpcRequest({ ipcPath, method: "updates.status", authToken: adminToken });
    assert.equal(upd.installedVersion, "1.1.0");

    // Admin logout revokes session immediately
    const logoutRes = await sendAdminIpcRequest({ ipcPath, method: "admin.logout", authToken: adminToken });
    assert.equal(logoutRes.revoked, true);

    await assert.rejects(
      () => sendAdminIpcRequest({ ipcPath, method: "overview.get", authToken: adminToken }),
      /revoked or expired/i
    );

    // Fresh admin login works
    const login2 = await sendAdminIpcRequest({
      ipcPath,
      method: "admin.login",
      params: { username: "serveradmin", password: "AdminStrongPassword!2026" }
    });
    assert.ok(login2.token);
  } finally {
    await env.cleanup();
  }
});
