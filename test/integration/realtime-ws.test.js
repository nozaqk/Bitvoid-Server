import test from "node:test";
import assert from "node:assert/strict";
import WebSocket from "ws";
import { createTestServer } from "../helpers/testContext.js";
import { WS_CLOSE_CODES } from "../../src/config/constants.js";

function openAuthedWs(wsUrl, token) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(wsUrl, {
      headers: { Authorization: `Bearer ${token}` }
    });
    ws.once("error", reject);
    ws.once("message", (raw) => {
      const msg = JSON.parse(raw.toString());
      if (msg.type === "connected") {
        resolve({ ws, connectedEvent: msg });
      } else {
        reject(new Error(`Unexpected first WS event: ${raw.toString()}`));
      }
    });
  });
}

function waitForClose(ws, timeoutMs = 3000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("Timed out waiting for WS close")), timeoutMs);
    ws.once("close", (code, reasonBuf) => {
      clearTimeout(timer);
      resolve({ code, reason: reasonBuf.toString("utf8") });
    });
  });
}

test("WebSocket rejects missing tokens and query-string tokens", async () => {
  const env = await createTestServer();
  try {
    const { baseUrl, wsUrl } = await env.listen();
    const reg = await (
      await fetch(`${baseUrl}/api/v1/account/register`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ username: "wsguard", password: "WsGuardPassword!123" })
      })
    ).json();

    // Missing Authorization header
    const noAuthClose = await new Promise((resolve) => {
      const ws = new WebSocket(wsUrl);
      ws.once("close", (code) => resolve(code));
    });
    assert.equal(noAuthClose, WS_CLOSE_CODES.POLICY_VIOLATION);

    // Token passed via query string MUST NOT be accepted
    const queryAuthClose = await new Promise((resolve) => {
      const ws = new WebSocket(`${wsUrl}?token=${encodeURIComponent(reg.token)}`);
      ws.once("close", (code) => resolve(code));
    });
    assert.equal(queryAuthClose, WS_CLOSE_CODES.POLICY_VIOLATION);
  } finally {
    await env.cleanup();
  }
});

test("Revoking a session, revoking a device, or suspending a Node immediately terminates open WebSockets and tracks per-Node bytes", async () => {
  const env = await createTestServer();
  try {
    const { baseUrl, wsUrl } = await env.listen();

    const reg = await (
      await fetch(`${baseUrl}/api/v1/account/register`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          username: "wsuser",
          password: "WsUserPassword!123",
          device: { displayName: "Phone 1", platform: "android", deviceFingerprint: "fp-ws-1" }
        })
      })
    ).json();

    // 1. Session revoke immediately closes active WS with code 4001
    const { ws: ws1 } = await openAuthedWs(wsUrl, reg.token);
    const closePromise1 = waitForClose(ws1);

    // Send a ping first so we can verify per-Node WS byte accounting too.
    await new Promise((resolve) => {
      ws1.once("message", () => resolve());
      ws1.send(JSON.stringify({ type: "ping", id: "traffic-check" }));
    });

    const revRes = await fetch(`${baseUrl}/api/v1/auth/revoke`, {
      method: "POST",
      headers: { authorization: `Bearer ${reg.token}` }
    });
    assert.equal(revRes.status, 200);
    const revBody = await revRes.json();
    assert.equal(revBody.data.disconnectedSockets, 1);

    const closed1 = await closePromise1;
    assert.equal(closed1.code, WS_CLOSE_CODES.SESSION_REVOKED);

    // 2. Device revoke immediately closes active WS with code 4003
    const login2 = await (
      await fetch(`${baseUrl}/api/v1/account/login`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          username: "wsuser",
          password: "WsUserPassword!123",
          device: { displayName: "Phone 2", platform: "android", deviceFingerprint: "fp-ws-2" }
        })
      })
    ).json();

    const { ws: ws2 } = await openAuthedWs(wsUrl, login2.token);
    const closePromise2 = waitForClose(ws2);

    const delDevRes = await fetch(`${baseUrl}/api/v1/devices/${login2.device.id}`, {
      method: "DELETE",
      headers: { authorization: `Bearer ${login2.token}` }
    });
    assert.equal(delDevRes.status, 200);
    const closed2 = await closePromise2;
    assert.equal(closed2.code, WS_CLOSE_CODES.DEVICE_REVOKED);

    // 3. Suspending the Node immediately closes active WS
    const login3 = await (
      await fetch(`${baseUrl}/api/v1/account/login`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          username: "wsuser",
          password: "WsUserPassword!123",
          device: { displayName: "Phone 3", platform: "android", deviceFingerprint: "fp-ws-3" }
        })
      })
    ).json();
    const { ws: ws3 } = await openAuthedWs(wsUrl, login3.token);
    const closePromise3 = waitForClose(ws3);

    env.ctx.nodeService.setNodeStatus({
      nodeId: reg.account.id,
      status: "suspended",
      actorId: "adm_test",
      reason: "policy_test"
    });
    const closed3 = await closePromise3;
    assert.equal(closed3.code, WS_CLOSE_CODES.SESSION_REVOKED);

    // Verify truthful per-Node HTTP + WS byte attribution
    const traffic = env.ctx.metricsService.getNodeTraffic(reg.account.id);
    assert.ok(traffic.wsRxBytes > 0, "Should record inbound WS bytes");
    assert.ok(traffic.wsTxBytes > 0, "Should record outbound WS bytes");
    assert.ok(traffic.httpTxBytes > 0, "Should record outbound HTTP bytes");
  } finally {
    await env.cleanup();
  }
});
