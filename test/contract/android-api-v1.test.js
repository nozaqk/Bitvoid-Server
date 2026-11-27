import test from "node:test";
import assert from "node:assert/strict";
import WebSocket from "ws";
import { createTestServer } from "../helpers/testContext.js";

test("Android API v1 contract: health, server info, register, login, me, recover, revoke, WS handshake", async () => {
  const env = await createTestServer();
  try {
    const { baseUrl, wsUrl, serverId } = await env.listen();

    // 1. GET /api/v1/health
    const healthRes = await fetch(`${baseUrl}/api/v1/health`);
    assert.equal(healthRes.status, 200);
    const health = await healthRes.json();
    assert.equal(health.ok, true);
    assert.equal(health.status, "ready");
    assert.equal(health.serverId, serverId);
    assert.ok(typeof health.apiVersion === "string");

    // 2. GET /api/v1/server/info
    const infoRes = await fetch(`${baseUrl}/api/v1/server/info`);
    assert.equal(infoRes.status, 200);
    const info = await infoRes.json();
    assert.equal(info.data.serverId, serverId);
    assert.equal(info.data.eventProtocolVersion, 1);
    assert.equal(info.data.transport, "http");
    assert.ok(Array.isArray(info.data.capabilities));
    assert.ok(info.data.capabilities.includes("account-auth"));
    assert.equal(info.data.links.events, "/api/v1/events");
    assert.ok(info.meta.requestId);
    assert.ok(info.meta.serverTime);

    // 3. POST /api/v1/account/register (exact Android BitVoidAccountAuth payload)
    const regRes = await fetch(`${baseUrl}/api/v1/account/register`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        username: "AndroidUser_01",
        password: "AndroidStrongPassword123!"
      })
    });
    assert.equal(regRes.status, 201);
    const reg = await regRes.json();
    assert.equal(reg.account.username, "androiduser_01");
    assert.ok(reg.account.id.startsWith("usr_"));
    assert.ok(typeof reg.token === "string" && reg.token.split(".").length === 3);
    assert.ok(typeof reg.refreshToken === "string" && reg.refreshToken.startsWith("bvr_"));
    assert.match(reg.masterPassphrase, /^[0-9a-f]{44}$/);
    assert.ok(reg.device?.id?.startsWith("dev_"));

    // 4. GET /api/v1/me
    const meRes = await fetch(`${baseUrl}/api/v1/me`, {
      headers: { authorization: `Bearer ${reg.token}` }
    });
    assert.equal(meRes.status, 200);
    const me = await meRes.json();
    assert.equal(me.data.account.id, reg.account.id);
    assert.equal(me.data.account.username, "androiduser_01");
    assert.equal(me.data.node.nodeId, reg.account.id);
    assert.equal(me.data.device.id, reg.device.id);

    // 5. WS /api/v1/events handshake with Authorization header + ping/pong
    const wsResult = await new Promise((resolve, reject) => {
      const ws = new WebSocket(wsUrl, {
        headers: { Authorization: `Bearer ${reg.token}` }
      });
      const events = [];
      ws.on("error", reject);
      ws.on("message", (raw) => {
        const msg = JSON.parse(raw.toString());
        events.push(msg);
        if (msg.type === "connected") {
          ws.send(JSON.stringify({ type: "ping", id: "hb-1" }));
        } else if (msg.type === "pong") {
          ws.close(1000);
          resolve(events);
        }
      });
    });
    assert.equal(wsResult[0].type, "connected");
    assert.equal(wsResult[0].serverId, serverId);
    assert.equal(wsResult[1].type, "pong");
    assert.equal(wsResult[1].id, "hb-1");

    // 6. POST /api/v1/auth/revoke revokes current session
    const revRes = await fetch(`${baseUrl}/api/v1/auth/revoke`, {
      method: "POST",
      headers: { authorization: `Bearer ${reg.token}` }
    });
    assert.equal(revRes.status, 200);
    const rev = await revRes.json();
    assert.equal(rev.data.revoked, true);

    // Revoked token must now return 401 session_revoked
    const meAfterRevoke = await fetch(`${baseUrl}/api/v1/me`, {
      headers: { authorization: `Bearer ${reg.token}` }
    });
    assert.equal(meAfterRevoke.status, 401);
    const errBody = await meAfterRevoke.json();
    assert.equal(errBody.error.code, "session_revoked");
    assert.ok(errBody.meta.requestId);

    // 7. POST /api/v1/account/login works again
    const loginRes = await fetch(`${baseUrl}/api/v1/account/login`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        username: "androiduser_01",
        password: "AndroidStrongPassword123!"
      })
    });
    assert.equal(loginRes.status, 200);
    const login = await loginRes.json();
    assert.equal(login.account.id, reg.account.id);
    assert.ok(login.token);

    // 8. POST /api/v1/account/recover resets password and revokes previous session
    const recRes = await fetch(`${baseUrl}/api/v1/account/recover`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        masterPassphrase: reg.masterPassphrase,
        newPassword: "NewRecoveredPassword456!"
      })
    });
    assert.equal(recRes.status, 200);
    const rec = await recRes.json();
    assert.equal(rec.account.id, reg.account.id);
    assert.ok(rec.token);

    // Previous login token must be revoked after recovery
    const oldTokenMe = await fetch(`${baseUrl}/api/v1/me`, {
      headers: { authorization: `Bearer ${login.token}` }
    });
    assert.equal(oldTokenMe.status, 401);
  } finally {
    await env.cleanup();
  }
});
