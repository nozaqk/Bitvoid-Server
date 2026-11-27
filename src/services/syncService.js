import { generateOpaqueId, nowIso } from "../security/crypto.js";
import { parsePageLimit } from "../security/validation.js";

/**
 * Durable ordered synchronization log & real-time event fan-out service.
 * Every state change writes ordered rows into `sync_events` per affected Node so offline devices
 * and multiple devices per Node stay completely consistent after reconnection.
 */
export class SyncService {
  constructor({ db, eventHub = null }) {
    this.db = db;
    this.eventHub = eventHub;
    this._insertEventStmt = db.prepare(`
      INSERT INTO sync_events (
        event_id, account_id, event_type, entity_type, entity_id, payload_json, occurred_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?)
    `);
  }

  appendEvent({ accountId, eventType, entityType, entityId, payload, realtime = true, excludeSessionId = null }) {
    const eventId = generateOpaqueId("evt");
    const occurredAt = nowIso();
    const payloadJson = JSON.stringify(payload);

    const info = this._insertEventStmt.run(
      eventId,
      accountId,
      eventType,
      entityType,
      entityId,
      payloadJson,
      occurredAt
    );

    const record = {
      seq: Number(info.lastInsertRowid),
      eventId,
      accountId,
      eventType,
      entityType,
      entityId,
      payload,
      occurredAt
    };

    if (realtime && this.eventHub) {
      this.eventHub.sendToAccount(
        accountId,
        {
          eventId,
          seq: record.seq,
          type: eventType,
          entityType,
          entityId,
          payload,
          occurredAt
        },
        { excludeSessionId }
      );
    }

    return record;
  }

  appendEventForAccounts(accountIds, { eventType, entityType, entityId, payload, realtime = true, excludeSessionId = null }) {
    const unique = [...new Set(accountIds)];
    const created = [];
    const tx = this.db.transaction((ids) => {
      for (const accountId of ids) {
        const eventId = generateOpaqueId("evt");
        const occurredAt = nowIso();
        const info = this._insertEventStmt.run(
          eventId,
          accountId,
          eventType,
          entityType,
          entityId,
          JSON.stringify(payload),
          occurredAt
        );
        created.push({
          seq: Number(info.lastInsertRowid),
          eventId,
          accountId,
          eventType,
          entityType,
          entityId,
          payload,
          occurredAt
        });
      }
    });
    tx(unique);

    if (realtime && this.eventHub) {
      for (const item of created) {
        this.eventHub.sendToAccount(
          item.accountId,
          {
            eventId: item.eventId,
            seq: item.seq,
            type: item.eventType,
            entityType: item.entityType,
            entityId: item.entityId,
            payload: item.payload,
            occurredAt: item.occurredAt
          },
          { excludeSessionId }
        );
      }
    }

    return created;
  }

  pullEvents({ accountId, afterSeq = 0, limit = 100 }) {
    const safeAfter = Number.isInteger(Number(afterSeq)) && Number(afterSeq) >= 0 ? Number(afterSeq) : 0;
    const pageLimit = parsePageLimit(limit, 100);

    const rows = this.db
      .prepare(
        `SELECT seq, event_id, event_type, entity_type, entity_id, payload_json, occurred_at
         FROM sync_events
         WHERE account_id = ? AND seq > ?
         ORDER BY seq ASC
         LIMIT ?`
      )
      .all(accountId, safeAfter, pageLimit + 1);

    const hasMore = rows.length > pageLimit;
    const sliced = hasMore ? rows.slice(0, pageLimit) : rows;
    const events = sliced.map((row) => ({
      seq: row.seq,
      eventId: row.event_id,
      eventType: row.event_type,
      entityType: row.entity_type,
      entityId: row.entity_id,
      payload: JSON.parse(row.payload_json),
      occurredAt: row.occurred_at
    }));

    const nextCursor = events.length > 0 ? events[events.length - 1].seq : safeAfter;

    return {
      events,
      cursor: safeAfter,
      nextCursor,
      hasMore
    };
  }

  getDeviceCursor({ deviceId, accountId }) {
    if (!deviceId) return { deviceId: null, lastSeq: 0, updatedAt: null };
    const row = this.db
      .prepare(
        "SELECT device_id, last_seq, updated_at FROM device_sync_cursors WHERE device_id = ? AND account_id = ?"
      )
      .get(deviceId, accountId);
    if (!row) return { deviceId, lastSeq: 0, updatedAt: null };
    return {
      deviceId: row.device_id,
      lastSeq: row.last_seq,
      updatedAt: row.updated_at
    };
  }

  ackDeviceCursor({ deviceId, accountId, lastSeq }) {
    if (!deviceId) {
      throw new Error("A registered device session is required to acknowledge a sync cursor.");
    }
    const safeSeq = Number.isInteger(Number(lastSeq)) && Number(lastSeq) >= 0 ? Number(lastSeq) : 0;
    const now = nowIso();
    this.db
      .prepare(
        `INSERT INTO device_sync_cursors (device_id, account_id, last_seq, updated_at)
         VALUES (?, ?, ?, ?)
         ON CONFLICT(device_id) DO UPDATE SET
           last_seq = MAX(device_sync_cursors.last_seq, excluded.last_seq),
           updated_at = excluded.updated_at`
      )
      .run(deviceId, accountId, safeSeq, now);
    return this.getDeviceCursor({ deviceId, accountId });
  }
}
