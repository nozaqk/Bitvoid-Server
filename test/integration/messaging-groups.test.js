import test from "node:test";
import assert from "node:assert/strict";
import WebSocket from "ws";
import { createTestServer } from "../helpers/testContext.js";

async function registerNode(baseUrl, username, deviceName = "Android") {
  const res = await fetch(`${baseUrl}/api/v1/account/register`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      username,
      password: `${username}Password!2026`,
      device: { displayName: deviceName, platform: "android", deviceFingerprint: `fp-${username}-${deviceName}` }
    })
  });
  assert.equal(res.status, 201);
  return res.json();
}

test("Direct & group conversations, membership authorization, idempotency, edits/deletes, receipts, and realtime WebSocket fan-out", async () => {
  const env = await createTestServer();
  try {
    const { baseUrl, wsUrl } = await env.listen();
    const alice = await registerNode(baseUrl, "alice_msg");
    const bob = await registerNode(baseUrl, "bob_msg");
    const charlie = await registerNode(baseUrl, "charlie_msg");

    // Open WebSocket for Bob so we verify live message delivery & typing indicators.
    const bobEvents = [];
    const bobWs = await new Promise((resolve, reject) => {
      const ws = new WebSocket(wsUrl, {
        headers: { Authorization: `Bearer ${bob.token}` }
      });
      ws.on("error", reject);
      ws.on("message", (raw) => {
        const parsed = JSON.parse(raw.toString());
        bobEvents.push(parsed);
        if (parsed.type === "connected") resolve(ws);
      });
    });

    // 1. Create direct conversation Alice <-> Bob (idempotent deduplication)
    const dm1Res = await fetch(`${baseUrl}/api/v1/conversations`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${alice.token}`,
        "content-type": "application/json"
      },
      body: JSON.stringify({ type: "direct", peerNodeId: bob.account.id })
    });
    assert.equal(dm1Res.status, 201);
    const dm1 = await dm1Res.json();

    const dm2Res = await fetch(`${baseUrl}/api/v1/conversations`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${bob.token}`,
        "content-type": "application/json"
      },
      body: JSON.stringify({ type: "direct", peerNodeId: alice.account.id })
    });
    assert.equal(dm2Res.status, 200);
    const dm2 = await dm2Res.json();
    assert.equal(dm1.data.conversation.id, dm2.data.conversation.id);
    assert.equal(dm2.data.created, false);

    const convId = dm1.data.conversation.id;

    // 2. Charlie (non-member) is strictly denied access (403)
    const charlieRead = await fetch(`${baseUrl}/api/v1/conversations/${convId}/messages`, {
      headers: { authorization: `Bearer ${charlie.token}` }
    });
    assert.equal(charlieRead.status, 403);

    // Charlie is also denied WebSocket topic subscription
    const charlieSubResult = await new Promise((resolve, reject) => {
      const ws = new WebSocket(wsUrl, {
        headers: { Authorization: `Bearer ${charlie.token}` }
      });
      ws.on("error", reject);
      ws.on("message", (raw) => {
        const msg = JSON.parse(raw.toString());
        if (msg.type === "connected") {
          ws.send(JSON.stringify({ type: "subscribe", topic: `conversation:${convId}` }));
        } else if (msg.type === "subscription_error") {
          ws.close(1000);
          resolve(msg);
        }
      });
    });
    assert.equal(charlieSubResult.code, "forbidden");

    // 3. Alice sends a message with clientMessageId (offline retry idempotency!)
    const msgPayload = {
      body: "Hello Bob over BitVoid!",
      clientMessageId: "offline-queue-001"
    };
    const send1 = await (
      await fetch(`${baseUrl}/api/v1/conversations/${convId}/messages`, {
        method: "POST",
        headers: {
          authorization: `Bearer ${alice.token}`,
          "content-type": "application/json"
        },
        body: JSON.stringify(msgPayload)
      })
    ).json();
    assert.equal(send1.data.deduplicated, false);

    // Retry exact same clientMessageId -> returns original message, zero duplicate!
    const send2Res = await fetch(`${baseUrl}/api/v1/conversations/${convId}/messages`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${alice.token}`,
        "content-type": "application/json"
      },
      body: JSON.stringify(msgPayload)
    });
    assert.equal(send2Res.status, 200);
    const send2 = await send2Res.json();
    assert.equal(send2.data.deduplicated, true);
    assert.equal(send2.data.message.id, send1.data.message.id);

    // Confirm Bob received realtime WS event for message.created
    await new Promise((r) => setTimeout(r, 60));
    const liveMsgEvent = bobEvents.find((e) => e.type === "message.created");
    assert.ok(liveMsgEvent, "Bob should receive message.created in real time over WebSocket");
    assert.equal(liveMsgEvent.payload.message.id, send1.data.message.id);
    assert.equal(liveMsgEvent.payload.message.body, "Hello Bob over BitVoid!");

    // 4. Bob posts delivered + read receipts
    const receiptRes = await fetch(
      `${baseUrl}/api/v1/conversations/${convId}/messages/${send1.data.message.id}/receipts`,
      {
        method: "POST",
        headers: {
          authorization: `Bearer ${bob.token}`,
          "content-type": "application/json"
        },
        body: JSON.stringify({ status: "read" })
      }
    );
    assert.equal(receiptRes.status, 200);

    // 5. Edit & soft-delete message
    const editRes = await fetch(
      `${baseUrl}/api/v1/conversations/${convId}/messages/${send1.data.message.id}`,
      {
        method: "PATCH",
        headers: {
          authorization: `Bearer ${alice.token}`,
          "content-type": "application/json"
        },
        body: JSON.stringify({ body: "Hello Bob (edited)!" })
      }
    );
    assert.equal(editRes.status, 200);
    const edited = await editRes.json();
    assert.equal(edited.data.message.body, "Hello Bob (edited)!");
    assert.ok(edited.data.message.editedAt);

    // Bob cannot edit Alice's message
    const bobEdit = await fetch(
      `${baseUrl}/api/v1/conversations/${convId}/messages/${send1.data.message.id}`,
      {
        method: "PATCH",
        headers: {
          authorization: `Bearer ${bob.token}`,
          "content-type": "application/json"
        },
        body: JSON.stringify({ body: "Hijack" })
      }
    );
    assert.equal(bobEdit.status, 403);

    // Soft delete creates tombstone and clears body
    const delRes = await fetch(
      `${baseUrl}/api/v1/conversations/${convId}/messages/${send1.data.message.id}`,
      {
        method: "DELETE",
        headers: { authorization: `Bearer ${alice.token}` }
      }
    );
    assert.equal(delRes.status, 200);

    const history = await (
      await fetch(`${baseUrl}/api/v1/conversations/${convId}/messages`, {
        headers: { authorization: `Bearer ${bob.token}` }
      })
    ).json();
    assert.equal(history.data.messages.length, 1);
    assert.equal(history.data.messages[0].body, "");
    assert.ok(history.data.messages[0].deletedAt);

    // 6. Group conversation with add/remove members
    const grpRes = await fetch(`${baseUrl}/api/v1/conversations`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${alice.token}`,
        "content-type": "application/json"
      },
      body: JSON.stringify({
        type: "group",
        title: "Engineering Study Group",
        memberIds: [bob.account.id]
      })
    });
    assert.equal(grpRes.status, 201);
    const grp = await grpRes.json();
    const grpId = grp.data.conversation.id;

    // Alice (owner) adds Charlie
    const addRes = await fetch(`${baseUrl}/api/v1/conversations/${grpId}/members`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${alice.token}`,
        "content-type": "application/json"
      },
      body: JSON.stringify({ nodeId: charlie.account.id })
    });
    assert.equal(addRes.status, 200);
    const added = await addRes.json();
    assert.equal(added.data.conversation.members.length, 3);

    // Charlie can now post in the group
    const grpMsgRes = await fetch(`${baseUrl}/api/v1/conversations/${grpId}/messages`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${charlie.token}`,
        "content-type": "application/json"
      },
      body: JSON.stringify({ body: "Glad to join the group!" })
    });
    assert.equal(grpMsgRes.status, 201);

    bobWs.close(1000);
  } finally {
    await env.cleanup();
  }
});
