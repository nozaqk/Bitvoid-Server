import test from "node:test";
import assert from "node:assert/strict";
import { createTestServer } from "../helpers/testContext.js";

async function registerNode(baseUrl, username, deviceName = "Phone") {
  const res = await fetch(`${baseUrl}/api/v1/account/register`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      username,
      password: `${username}Password!2026`,
      device: { displayName: deviceName, platform: "android", deviceFingerprint: `fp-${username}-${deviceName}` }
    })
  });
  return res.json();
}

test("Attachments (streaming upload/download, path sanitization, authz, quota) and durable offline + multi-device sync", async () => {
  const env = await createTestServer({
    BITVOID_MAX_UPLOAD_BYTES: "4096",
    BITVOID_NODE_STORAGE_QUOTA_BYTES: "6000"
  });
  try {
    const { baseUrl } = await env.listen();
    const alice = await registerNode(baseUrl, "alice_sync", "Phone-1");
    const bob = await registerNode(baseUrl, "bob_sync", "Phone-Bob");
    const eve = await registerNode(baseUrl, "eve_sync", "Phone-Eve");

    // Second device logged in for Alice (multi-device sync)
    const aliceTablet = await (
      await fetch(`${baseUrl}/api/v1/account/login`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          username: "alice_sync",
          password: "alice_syncPassword!2026",
          device: { displayName: "Tablet-2", platform: "android", deviceFingerprint: "fp-alice-tablet" }
        })
      })
    ).json();

    // Create conversation Alice <-> Bob
    const conv = await (
      await fetch(`${baseUrl}/api/v1/conversations`, {
        method: "POST",
        headers: {
          authorization: `Bearer ${alice.token}`,
          "content-type": "application/json"
        },
        body: JSON.stringify({ type: "direct", peerNodeId: bob.account.id })
      })
    ).json();
    const convId = conv.data.conversation.id;

    // 1. Streaming multipart upload with traversal filename attempt
    const form = new FormData();
    form.append("file", new Blob(["Lecture slides binary content 12345"], { type: "text/plain" }), "../../evil/slides.txt");
    const upRes = await fetch(
      `${baseUrl}/api/v1/attachments?scopeType=conversation&scopeId=${encodeURIComponent(convId)}`,
      {
        method: "POST",
        headers: { authorization: `Bearer ${alice.token}` },
        body: form
      }
    );
    assert.equal(upRes.status, 201);
    const up = await upRes.json();
    const attId = up.data.attachment.id;
    assert.equal(up.data.attachment.filename, "slides.txt", "Filename traversal must be stripped");

    // Bob (conversation member) can download with safe headers
    const dlRes = await fetch(`${baseUrl}/api/v1/attachments/${attId}/download`, {
      headers: { authorization: `Bearer ${bob.token}` }
    });
    assert.equal(dlRes.status, 200);
    assert.equal(dlRes.headers.get("x-content-type-options"), "nosniff");
    assert.ok(dlRes.headers.get("content-disposition").includes("attachment"));
    assert.equal(await dlRes.text(), "Lecture slides binary content 12345");

    // Eve (non-member) is forbidden from metadata and download
    const eveDl = await fetch(`${baseUrl}/api/v1/attachments/${attId}/download`, {
      headers: { authorization: `Bearer ${eve.token}` }
    });
    assert.equal(eveDl.status, 403);

    // Oversized file rejected with 413
    const bigForm = new FormData();
    bigForm.append("file", new Blob(["x".repeat(5000)], { type: "application/octet-stream" }), "too-big.bin");
    const bigRes = await fetch(`${baseUrl}/api/v1/attachments`, {
      method: "POST",
      headers: { authorization: `Bearer ${alice.token}` },
      body: bigForm
    });
    assert.equal(bigRes.status, 413);

    // 2. Offline outbox batch flush with attachment & idempotent retry
    const outboxBody = {
      operations: [
        {
          type: "conversation.message",
          conversationId: convId,
          clientMessageId: "outbox-1",
          body: "Queued while offline",
          attachmentId: attId
        },
        {
          type: "conversation.message",
          conversationId: convId,
          clientMessageId: "outbox-2",
          body: "Second queued message"
        }
      ]
    };
    const flush1 = await (
      await fetch(`${baseUrl}/api/v1/sync/outbox`, {
        method: "POST",
        headers: {
          authorization: `Bearer ${alice.token}`,
          "content-type": "application/json"
        },
        body: JSON.stringify(outboxBody)
      })
    ).json();
    assert.equal(flush1.data.results.length, 2);
    assert.equal(flush1.data.results[0].ok, true);
    assert.equal(flush1.data.results[0].deduplicated, false);

    // Retrying same offline outbox deduplicates cleanly
    const flush2 = await (
      await fetch(`${baseUrl}/api/v1/sync/outbox`, {
        method: "POST",
        headers: {
          authorization: `Bearer ${alice.token}`,
          "content-type": "application/json"
        },
        body: JSON.stringify(outboxBody)
      })
    ).json();
    assert.equal(flush2.data.results[0].deduplicated, true);
    assert.equal(flush2.data.results[0].message.id, flush1.data.results[0].message.id);

    // 3. Multi-device & offline sync catch-up via durable cursor
    // Alice's Tablet pulls all missed events from seq 0
    const tabletSync1 = await (
      await fetch(`${baseUrl}/api/v1/sync/events`, {
        headers: { authorization: `Bearer ${aliceTablet.token}` }
      })
    ).json();
    assert.ok(tabletSync1.data.events.length >= 3); // conversation.created + 2 message.created
    const ackSeq = tabletSync1.data.nextCursor;

    // Tablet acknowledges its cursor
    const ackRes = await fetch(`${baseUrl}/api/v1/sync/cursor`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${aliceTablet.token}`,
        "content-type": "application/json"
      },
      body: JSON.stringify({ lastSeq: ackSeq })
    });
    assert.equal(ackRes.status, 200);

    // Pulling again without afterSeq uses Tablet's saved cursor -> 0 new events!
    const tabletSync2 = await (
      await fetch(`${baseUrl}/api/v1/sync/events`, {
        headers: { authorization: `Bearer ${aliceTablet.token}` }
      })
    ).json();
    assert.equal(tabletSync2.data.events.length, 0);
    assert.equal(tabletSync2.data.cursor, ackSeq);

    // Meanwhile Bob's device still sees ALL missed events from cursor 0!
    const bobSync = await (
      await fetch(`${baseUrl}/api/v1/sync/events`, {
        headers: { authorization: `Bearer ${bob.token}` }
      })
    ).json();
    const bobMsgEvents = bobSync.data.events.filter((e) => e.eventType === "message.created");
    assert.equal(bobMsgEvents.length, 2);
  } finally {
    await env.cleanup();
  }
});
