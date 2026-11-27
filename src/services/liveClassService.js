import { LIMITS } from "../config/constants.js";
import { generateOpaqueId, nowIso } from "../security/crypto.js";
import { parsePageLimit } from "../security/validation.js";

const VALID_SIGNAL_TYPES = new Set([
  "offer",
  "answer",
  "ice-candidate",
  "mute",
  "unmute",
  "raise-hand",
  "leave"
]);

function makeError(statusCode, code, message) {
  const err = new Error(message);
  err.statusCode = statusCode;
  err.code = code;
  return err;
}

/**
 * Live Classes & WebRTC Signaling Service.
 * Manages classroom lifecycle (scheduled -> live -> ended), participant membership/roles,
 * and authenticated WebRTC signaling relay with short retention.
 */
export class LiveClassService {
  constructor({ db, syncService, eventHub = null }) {
    this.db = db;
    this.syncService = syncService;
    this.eventHub = eventHub;
  }

  isActiveMember(classId, accountId) {
    const row = this.db
      .prepare(
        "SELECT role FROM live_class_members WHERE class_id = ? AND account_id = ? AND left_at IS NULL"
      )
      .get(classId, accountId);
    return row ? row.role : null;
  }

  _hydrateClass(classId) {
    const row = this.db
      .prepare(
        `SELECT lc.*, a.username AS host_username, a.display_name AS host_display_name
         FROM live_classes lc
         JOIN accounts a ON a.id = lc.host_account_id
         WHERE lc.id = ?`
      )
      .get(classId);
    if (!row) return null;

    const participants = this.db
      .prepare(
        `SELECT m.account_id, m.role, m.joined_at, a.username, a.display_name
         FROM live_class_members m
         JOIN accounts a ON a.id = m.account_id
         WHERE m.class_id = ? AND m.left_at IS NULL
         ORDER BY m.joined_at ASC`
      )
      .all(classId)
      .map((p) => ({
        nodeId: p.account_id,
        username: p.username,
        displayName: p.display_name || p.username,
        role: p.role,
        joinedAt: p.joined_at
      }));

    return {
      id: row.id,
      title: row.title,
      description: row.description,
      hostNodeId: row.host_account_id,
      hostUsername: row.host_username,
      hostDisplayName: row.host_display_name || row.host_username,
      channelId: row.channel_id,
      status: row.status,
      startedAt: row.started_at,
      endedAt: row.ended_at,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      participants
    };
  }

  createClass({ hostAccountId, title, description = "", channelId = null, startImmediately = false }) {
    if (typeof title !== "string" || title.trim().length < 2 || title.trim().length > LIMITS.CLASS_TITLE_MAX) {
      throw makeError(400, "validation_error", `Live Class title must be 2-${LIMITS.CLASS_TITLE_MAX} characters.`);
    }
    const cleanDesc = typeof description === "string" ? description.trim().slice(0, 500) : "";

    if (channelId) {
      const ch = this.db.prepare("SELECT id FROM channels WHERE id = ?").get(channelId);
      if (!ch) throw makeError(404, "channel_not_found", "Linked channel not found.");
    }

    const id = generateOpaqueId("cls");
    const now = nowIso();
    const status = startImmediately ? "live" : "scheduled";

    const tx = this.db.transaction(() => {
      this.db
        .prepare(
          `INSERT INTO live_classes (
            id, title, description, host_account_id, channel_id,
            status, started_at, created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .run(
          id,
          title.trim(),
          cleanDesc,
          hostAccountId,
          channelId,
          status,
          startImmediately ? now : null,
          now,
          now
        );
      this.db
        .prepare(
          "INSERT INTO live_class_members (class_id, account_id, role, joined_at) VALUES (?, ?, 'host', ?)"
        )
        .run(id, hostAccountId, now);
    });
    tx();

    const hydrated = this._hydrateClass(id);
    this.syncService.appendEvent({
      accountId: hostAccountId,
      eventType: "live_class.created",
      entityType: "live_class",
      entityId: id,
      payload: { liveClass: hydrated }
    });
    return hydrated;
  }

  listClasses({ status = null, limit = 50 } = {}) {
    const pageLimit = parsePageLimit(limit, 50);
    const rows = status && ["scheduled", "live", "ended"].includes(status)
      ? this.db
          .prepare("SELECT id FROM live_classes WHERE status = ? ORDER BY updated_at DESC LIMIT ?")
          .all(status, pageLimit)
      : this.db
          .prepare("SELECT id FROM live_classes ORDER BY updated_at DESC LIMIT ?")
          .all(pageLimit);
    return rows.map((r) => this._hydrateClass(r.id));
  }

  getClass(classId) {
    return this._hydrateClass(classId);
  }

  startClass({ classId, actorId }) {
    const cls = this.db.prepare("SELECT * FROM live_classes WHERE id = ?").get(classId);
    if (!cls) throw makeError(404, "class_not_found", "Live Class not found.");
    if (cls.host_account_id !== actorId) {
      throw makeError(403, "forbidden", "Only the Live Class host can start the session.");
    }
    if (cls.status === "ended") {
      throw makeError(409, "class_already_ended", "Cannot restart an ended Live Class.");
    }
    const now = nowIso();
    this.db
      .prepare("UPDATE live_classes SET status = 'live', started_at = COALESCE(started_at, ?), updated_at = ? WHERE id = ?")
      .run(now, now, classId);

    const hydrated = this._hydrateClass(classId);
    const memberIds = hydrated.participants.map((p) => p.nodeId);
    this.syncService.appendEventForAccounts(memberIds, {
      eventType: "live_class.started",
      entityType: "live_class",
      entityId: classId,
      payload: { liveClass: hydrated }
    });
    return hydrated;
  }

  endClass({ classId, actorId }) {
    const cls = this.db.prepare("SELECT * FROM live_classes WHERE id = ?").get(classId);
    if (!cls) throw makeError(404, "class_not_found", "Live Class not found.");
    if (cls.host_account_id !== actorId) {
      throw makeError(403, "forbidden", "Only the Live Class host can end the session.");
    }
    const now = nowIso();
    const memberIds = this.db
      .prepare("SELECT account_id FROM live_class_members WHERE class_id = ? AND left_at IS NULL")
      .all(classId)
      .map((r) => r.account_id);

    this.db
      .prepare("UPDATE live_classes SET status = 'ended', ended_at = ?, updated_at = ? WHERE id = ?")
      .run(now, now, classId);

    const hydrated = this._hydrateClass(classId);
    this.syncService.appendEventForAccounts(memberIds, {
      eventType: "live_class.ended",
      entityType: "live_class",
      entityId: classId,
      payload: { liveClass: hydrated }
    });
    return hydrated;
  }

  joinClass({ classId, accountId }) {
    const cls = this.db.prepare("SELECT * FROM live_classes WHERE id = ?").get(classId);
    if (!cls) throw makeError(404, "class_not_found", "Live Class not found.");
    if (cls.status === "ended") {
      throw makeError(409, "class_already_ended", "This Live Class has ended.");
    }
    const now = nowIso();
    const role = cls.host_account_id === accountId ? "host" : "student";
    this.db
      .prepare(
        `INSERT INTO live_class_members (class_id, account_id, role, joined_at, left_at)
         VALUES (?, ?, ?, ?, NULL)
         ON CONFLICT(class_id, account_id) DO UPDATE SET left_at = NULL, joined_at = excluded.joined_at`
      )
      .run(classId, accountId, role, now);

    const hydrated = this._hydrateClass(classId);
    const memberIds = hydrated.participants.map((p) => p.nodeId);
    this.syncService.appendEventForAccounts(memberIds, {
      eventType: "live_class.participant_joined",
      entityType: "live_class",
      entityId: classId,
      payload: { classId, nodeId: accountId, role, participants: hydrated.participants }
    });
    return hydrated;
  }

  leaveClass({ classId, accountId }) {
    const now = nowIso();
    const memberIds = this.db
      .prepare("SELECT account_id FROM live_class_members WHERE class_id = ? AND left_at IS NULL")
      .all(classId)
      .map((r) => r.account_id);

    this.db
      .prepare("UPDATE live_class_members SET left_at = ? WHERE class_id = ? AND account_id = ?")
      .run(now, classId, accountId);

    this.syncService.appendEventForAccounts(memberIds, {
      eventType: "live_class.participant_left",
      entityType: "live_class",
      entityId: classId,
      payload: { classId, nodeId: accountId, leftAt: now }
    });
    return { left: true, classId };
  }

  relaySignal({
    classId,
    fromAccountId,
    fromDeviceId = null,
    toAccountId = null,
    signalType,
    payload = {}
  }) {
    if (!this.isActiveMember(classId, fromAccountId)) {
      throw makeError(403, "forbidden", "Join the Live Class before sending signaling events.");
    }
    const cls = this.db.prepare("SELECT status FROM live_classes WHERE id = ?").get(classId);
    if (!cls || cls.status !== "live") {
      throw makeError(409, "class_not_live", "Signaling is only permitted while the Live Class is live.");
    }
    if (!VALID_SIGNAL_TYPES.has(signalType)) {
      throw makeError(400, "validation_error", `Unsupported signalType: ${signalType}`);
    }
    const payloadJson = JSON.stringify(payload ?? {});
    if (Buffer.byteLength(payloadJson, "utf8") > LIMITS.SIGNAL_PAYLOAD_MAX) {
      throw makeError(413, "payload_too_large", "Signaling payload exceeds maximum size.");
    }

    if (toAccountId && !this.isActiveMember(classId, toAccountId)) {
      throw makeError(404, "recipient_not_in_class", "Target participant is not currently in this Live Class.");
    }

    const id = generateOpaqueId("sig");
    const createdAt = nowIso();
    // Short retention (15 minutes) for transient WebRTC signaling metadata.
    const expiresAt = new Date(Date.now() + 15 * 60 * 1000).toISOString();

    const info = this.db
      .prepare(
        `INSERT INTO call_signaling_events (
          id, class_id, from_account_id, from_device_id, to_account_id,
          signal_type, payload_json, created_at, expires_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(id, classId, fromAccountId, fromDeviceId, toAccountId, signalType, payloadJson, createdAt, expiresAt);

    const signal = {
      seq: Number(info.lastInsertRowid),
      id,
      classId,
      fromNodeId: fromAccountId,
      fromDeviceId,
      toNodeId: toAccountId,
      signalType,
      payload,
      createdAt
    };

    // Deliver over realtime WebSockets immediately (targeted or broadcast to other class participants).
    if (this.eventHub) {
      const targets = toAccountId
        ? [toAccountId]
        : this.db
            .prepare(
              "SELECT account_id FROM live_class_members WHERE class_id = ? AND left_at IS NULL AND account_id != ?"
            )
            .all(classId, fromAccountId)
            .map((r) => r.account_id);

      this.eventHub.sendToAccounts(targets, {
        type: "live_class.signal",
        entityType: "live_class",
        entityId: classId,
        payload: signal
      });
    }

    return signal;
  }

  listSignals({ classId, accountId, afterSeq = 0, limit = 100 }) {
    if (!this.isActiveMember(classId, accountId)) {
      throw makeError(403, "forbidden", "Join the Live Class to read signaling events.");
    }
    const now = nowIso();
    const safeAfter = Number.isInteger(Number(afterSeq)) ? Number(afterSeq) : 0;
    const pageLimit = parsePageLimit(limit, 100);
    const rows = this.db
      .prepare(
        `SELECT seq, id, class_id, from_account_id, from_device_id, to_account_id,
                signal_type, payload_json, created_at
         FROM call_signaling_events
         WHERE class_id = ? AND seq > ? AND expires_at > ?
           AND (to_account_id IS NULL OR to_account_id = ? OR from_account_id = ?)
         ORDER BY seq ASC
         LIMIT ?`
      )
      .all(classId, safeAfter, now, accountId, accountId, pageLimit);

    return rows.map((r) => ({
      seq: r.seq,
      id: r.id,
      classId: r.class_id,
      fromNodeId: r.from_account_id,
      fromDeviceId: r.from_device_id,
      toNodeId: r.to_account_id,
      signalType: r.signal_type,
      payload: JSON.parse(r.payload_json),
      createdAt: r.created_at
    }));
  }

  purgeExpiredSignals() {
    const res = this.db
      .prepare("DELETE FROM call_signaling_events WHERE expires_at <= ?")
      .run(nowIso());
    return res.changes;
  }
}
