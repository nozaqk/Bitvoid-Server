import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import jwt from "jsonwebtoken";
import { createTestServer } from "../helpers/testContext.js";

test("Security controls: account-keyed brute-force lockout, JWT tampering rejection, SQLi safety, cross-Node isolation, log redaction, and no browser admin route", async () => {
  const env = await createTestServer({
    BITVOID_AUTH_RATE_LIMIT_MAX: "5"
  });
  try {
    const { baseUrl } = await env.listen();

    // Register Node A and Node B
    const regA = await (
      await fetch(`${baseUrl}/api/v1/account/register`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          username: "alice_sec",
          password: "AliceTopSecretPassword!99"
        })
      })
    ).json();

    const regB = await (
      await fetch(`${baseUrl}/api/v1/account/register`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          username: "bob_sec",
          password: "BobTopSecretPassword!99"
        })
      })
    ).json();

    // 1. Cross-Node authorization isolation: Bob cannot revoke Alice's device or session
    const crossDevice = await fetch(`${baseUrl}/api/v1/devices/${regA.device.id}`, {
      method: "DELETE",
      headers: { authorization: `Bearer ${regB.token}` }
    });
    assert.equal(crossDevice.status, 404);

    // Verify Alice's token still works
    const aliceMe = await fetch(`${baseUrl}/api/v1/me`, {
      headers: { authorization: `Bearer ${regA.token}` }
    });
    assert.equal(aliceMe.status, 200);

    // 2. JWT algorithm confusion ("none") & forged secret rejection
    const headerNone = Buffer.from(JSON.stringify({ alg: "none", typ: "JWT" })).toString("base64url");
    const payloadForged = Buffer.from(
      JSON.stringify({ sub: regA.account.id, username: "alice_sec", sid: "fake", iss: "bitvoid-server", aud: "bitvoid-app" })
    ).toString("base64url");
    const noneToken = `${headerNone}.${payloadForged}.`;
    const noneRes = await fetch(`${baseUrl}/api/v1/me`, {
      headers: { authorization: `Bearer ${noneToken}` }
    });
    assert.equal(noneRes.status, 401);

    const wrongSecretToken = jwt.sign(
      { sub: regA.account.id, username: "alice_sec", sid: "fake" },
      "completely-wrong-signing-secret-32chars!",
      { algorithm: "HS256", issuer: "bitvoid-server", audience: "bitvoid-app" }
    );
    const wrongRes = await fetch(`${baseUrl}/api/v1/me`, {
      headers: { authorization: `Bearer ${wrongSecretToken}` }
    });
    assert.equal(wrongRes.status, 401);

    // 3. SQL injection attempt in login & directory search safely handled
    const sqliLogin = await fetch(`${baseUrl}/api/v1/account/login`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ username: "' OR 1=1 --", password: "anything1234" })
    });
    assert.equal(sqliLogin.status, 400);

    const sqliSearch = await fetch(
      `${baseUrl}/api/v1/nodes/directory?q=${encodeURIComponent("alice' OR '1'='1")}`,
      { headers: { authorization: `Bearer ${regA.token}` } }
    );
    assert.equal(sqliSearch.status, 200);
    const sqliBody = await sqliSearch.json();
    assert.equal(sqliBody.data.nodes.length, 0);

    // 4. Account-keyed brute-force lockout across repeated wrong passwords (independent of IP)
    for (let i = 0; i < 5; i += 1) {
      const fail = await env.ctx.authService.login({
        username: "alice_sec",
        password: "WrongPasswordAttempt!",
        ipAddress: `10.0.0.${i + 1}` // Simulated distinct client IPs
      });
      assert.equal(fail.status, 401);
    }
    const locked = await env.ctx.authService.login({
      username: "alice_sec",
      password: "AliceTopSecretPassword!99",
      ipAddress: "10.0.0.99"
    });
    assert.equal(locked.status, 429);
    assert.equal(locked.code, "rate_limited");

    // 5. NO browser admin dashboard or web page on the public HTTP port
    for (const path of ["/", "/admin", "/dashboard", "/api/v1/admin"]) {
      const res = await fetch(`${baseUrl}${path}`);
      assert.equal(res.status, 404, `Path ${path} must NOT be served on the HTTP port`);
    }

    // 6. Log redaction verification: NO passwords, recovery keys, or JWT tokens in log file!
    const logPath = join(env.ctx.config.logDir, "bitvoid-server.log");
    assert.ok(existsSync(logPath), "Structured log file should exist");
    const logContents = readFileSync(logPath, "utf8");
    assert.ok(!logContents.includes("AliceTopSecretPassword!99"), "Password must never appear in logs");
    assert.ok(!logContents.includes("BobTopSecretPassword!99"), "Password must never appear in logs");
    assert.ok(!logContents.includes(regA.masterPassphrase), "Recovery key must never appear in logs");
    assert.ok(!logContents.includes(regA.token), "Bearer JWT must never appear in logs");
    assert.ok(!logContents.includes(regA.refreshToken), "Refresh token must never appear in logs");
  } finally {
    await env.cleanup();
  }
});
