import test from "node:test";
import assert from "node:assert/strict";
import WebSocket from "ws";
import { createTestServer } from "../helpers/testContext.js";

async function registerNode(baseUrl, username) {
  const res = await fetch(`${baseUrl}/api/v1/account/register`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ username, password: `${username}Password!2026` })
  });
  return res.json();
}

test("Channels (public/private, roles, moderation) and Live Classes with realtime WebRTC signaling relay", async () => {
  const env = await createTestServer();
  try {
    const { baseUrl, wsUrl } = await env.listen();
    const teacher = await registerNode(baseUrl, "teacher_lc");
    const student = await registerNode(baseUrl, "student_lc");
    const outsider = await registerNode(baseUrl, "outsider_lc");

    // 1. Public & private channels
    const pubCh = await (
      await fetch(`${baseUrl}/api/v1/channels`, {
        method: "POST",
        headers: {
          authorization: `Bearer ${teacher.token}`,
          "content-type": "application/json"
        },
        body: JSON.stringify({
          slug: "cs-101",
          name: "Computer Science 101",
          description: "Course announcements",
          visibility: "public"
        })
      })
    ).json();
    assert.equal(pubCh.data.channel.slug, "cs-101");

    const privCh = await (
      await fetch(`${baseUrl}/api/v1/channels`, {
        method: "POST",
        headers: {
          authorization: `Bearer ${teacher.token}`,
          "content-type": "application/json"
        },
        body: JSON.stringify({
          slug: "faculty-private",
          name: "Faculty Only",
          visibility: "private"
        })
      })
    ).json();

    // Outsider cannot join or read private channel
    const joinPriv = await fetch(`${baseUrl}/api/v1/channels/${privCh.data.channel.id}/join`, {
      method: "POST",
      headers: { authorization: `Bearer ${outsider.token}` }
    });
    assert.equal(joinPriv.status, 403);

    // Student joins public channel and posts a message
    const joinPub = await fetch(`${baseUrl}/api/v1/channels/${pubCh.data.channel.id}/join`, {
      method: "POST",
      headers: { authorization: `Bearer ${student.token}` }
    });
    assert.equal(joinPub.status, 200);

    const chMsg = await (
      await fetch(`${baseUrl}/api/v1/channels/${pubCh.data.channel.id}/messages`, {
        method: "POST",
        headers: {
          authorization: `Bearer ${student.token}`,
          "content-type": "application/json"
        },
        body: JSON.stringify({ body: "Question about lab 2", clientMessageId: "ch-msg-1" })
      })
    ).json();
    assert.equal(chMsg.data.message.body, "Question about lab 2");

    // Teacher (owner) can moderate/delete student's channel message
    const modDel = await fetch(
      `${baseUrl}/api/v1/channels/${pubCh.data.channel.id}/messages/${chMsg.data.message.id}`,
      {
        method: "DELETE",
        headers: { authorization: `Bearer ${teacher.token}` }
      }
    );
    assert.equal(modDel.status, 200);

    // 2. Live Class lifecycle + WebRTC signaling
    const cls = await (
      await fetch(`${baseUrl}/api/v1/live-classes`, {
        method: "POST",
        headers: {
          authorization: `Bearer ${teacher.token}`,
          "content-type": "application/json"
        },
        body: JSON.stringify({
          title: "Distributed Systems Lecture 4",
          channelId: pubCh.data.channel.id
        })
      })
    ).json();
    const classId = cls.data.liveClass.id;
    assert.equal(cls.data.liveClass.status, "scheduled");

    // Non-host cannot start class
    const studentStart = await fetch(`${baseUrl}/api/v1/live-classes/${classId}/start`, {
      method: "POST",
      headers: { authorization: `Bearer ${student.token}` }
    });
    assert.equal(studentStart.status, 403);

    // Host starts class & student joins
    const started = await (
      await fetch(`${baseUrl}/api/v1/live-classes/${classId}/start`, {
        method: "POST",
        headers: { authorization: `Bearer ${teacher.token}` }
      })
    ).json();
    assert.equal(started.data.liveClass.status, "live");

    const joined = await (
      await fetch(`${baseUrl}/api/v1/live-classes/${classId}/join`, {
        method: "POST",
        headers: { authorization: `Bearer ${student.token}` }
      })
    ).json();
    assert.equal(joined.data.liveClass.participants.length, 2);

    // Connect student WS to verify real-time WebRTC offer delivery
    const studentSignals = [];
    const studentWs = await new Promise((resolve, reject) => {
      const ws = new WebSocket(wsUrl, {
        headers: { Authorization: `Bearer ${student.token}` }
      });
      ws.on("error", reject);
      ws.on("message", (raw) => {
        const evt = JSON.parse(raw.toString());
        if (evt.type === "connected") resolve(ws);
        else studentSignals.push(evt);
      });
    });

    // Teacher sends WebRTC SDP offer targeted to student
    const sigRes = await fetch(`${baseUrl}/api/v1/live-classes/${classId}/signals`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${teacher.token}`,
        "content-type": "application/json"
      },
      body: JSON.stringify({
        toNodeId: student.account.id,
        signalType: "offer",
        payload: { sdp: "v=0\r\no=- 12345 2 IN IP4 127.0.0.1\r\n" }
      })
    });
    assert.equal(sigRes.status, 201);

    await new Promise((r) => setTimeout(r, 60));
    const receivedOffer = studentSignals.find((e) => e.type === "live_class.signal");
    assert.ok(receivedOffer, "Student should receive WebRTC offer in real time");
    assert.equal(receivedOffer.payload.signalType, "offer");
    assert.equal(receivedOffer.payload.fromNodeId, teacher.account.id);

    // Outsider cannot read or inject signals into the Live Class
    const outsiderSig = await fetch(`${baseUrl}/api/v1/live-classes/${classId}/signals`, {
      headers: { authorization: `Bearer ${outsider.token}` }
    });
    assert.equal(outsiderSig.status, 403);

    // Host ends Live Class -> further signaling blocked (409)
    const ended = await (
      await fetch(`${baseUrl}/api/v1/live-classes/${classId}/end`, {
        method: "POST",
        headers: { authorization: `Bearer ${teacher.token}` }
      })
    ).json();
    assert.equal(ended.data.liveClass.status, "ended");

    const afterEndSig = await fetch(`${baseUrl}/api/v1/live-classes/${classId}/signals`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${teacher.token}`,
        "content-type": "application/json"
      },
      body: JSON.stringify({ signalType: "raise-hand", payload: {} })
    });
    assert.equal(afterEndSig.status, 409);

    studentWs.close(1000);
  } finally {
    await env.cleanup();
  }
});
