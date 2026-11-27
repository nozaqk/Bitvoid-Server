import { LIMITS } from "../config/constants.js";
import { generateOpaqueId, nowIso } from "../security/crypto.js";
import { parsePageLimit } from "../security/validation.js";

function makeError(statusCode, code, message) {
  const err = new Error(message);
  err.statusCode = statusCode;
  err.code = code;
  return err;
}

export class ChannelService {
  constructor({ db, syncService }) {
    this.db = db;
    this.syncService = syncService;
  }

  getMemberRole(channelId, accountId) {
    const row = this.db
      .prepare("SELECT role FROM channel_members WHERE channel_id = ? AND account_id = ?")
      .get(channelId, accountId);
    return row ? row.role : null;
  }

  canReadChannel(channelId, accountId) {
    const ch = this.db
      .prepare("SELECT id, visibility FROM channels WHERE id = ? AND archived_at IS NULL")
      .get(channelId);
    if (!ch) return false;
    if (ch.visibility === "public") return true;
    return Boolean(this.getMemberRole(channelId, accountId));
  }

  _hydrateChannel(channelId, viewerAccountId = null) {
    const ch = this.db.prepare("SELECT * FROM channels WHERE id = ?").get(channelId);
    if (!ch) return null;
    const countRow = this.db
      .prepare("SELECT COUNT(*) AS count FROM channel_members WHERE channel_id = ?")
      .get(channelId);
    const viewerRole = viewerAccountId ? this.getMemberRole(channelId, viewerAccountId) : null;
    return {
      id: ch.id,
      slug: ch.slug,
      name: ch.name,
      description: ch.description,
      visibility: ch.visibility,
      createdBy: ch.created_by,
      memberCount: countRow?.count || 0,
      viewerRole,
      createdAt: ch.created_at,
      updatedAt: ch.updated_at
    };
  }

  createChannel({ creatorId, slug, name, description = "", visibility = "public" }) {
    if (typeof name !== "string" || name.trim().length < 2 || name.trim().length > LIMITS.CHANNEL_NAME_MAX) {
      throw makeError(400, "validation_error", `Channel name must be 2-${LIMITS.CHANNEL_NAME_MAX} characters.`);
    }
    const rawSlug = typeof slug === "string" && slug.trim() ? slug.trim().toLowerCase() : name.trim().toLowerCase().replace(/[^a-z0-9-]+/g, "-").replace(/^-+|-+$/g, "");
    if (!/^[a-z0-9][a-z0-9-]{1,48}$/.test(rawSlug)) {
      throw makeError(400, "validation_error", "Channel slug must be 2-49 lowercase letters, numbers, or hyphens.");
    }
    if (visibility !== "public" && visibility !== "private") {
      throw makeError(400, "validation_error", "Channel visibility must be 'public' or 'private'.");
    }
    const cleanDesc = typeof description === "string" ? description.trim().slice(0, LIMITS.CHANNEL_DESC_MAX) : "";

    const existing = this.db.prepare("SELECT id FROM channels WHERE slug = ? COLLATE NOCASE").get(rawSlug);
    if (existing) {
      throw makeError(409, "slug_taken", "A channel with that slug already exists.");
    }

    const id = generateOpaqueId("chn");
    const now = nowIso();
    const tx = this.db.transaction(() => {
      this.db
        .prepare(
          `INSERT INTO channels (id, slug, name, description, visibility, created_by, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .run(id, rawSlug, name.trim(), cleanDesc, visibility, creatorId, now, now);
      this.db
        .prepare("INSERT INTO channel_members (channel_id, account_id, role, joined_at) VALUES (?, ?, 'owner', ?)")
        .run(id, creatorId, now);
    });
    tx();

    const channel = this._hydrateChannel(id, creatorId);
    this.syncService.appendEvent({
      accountId: creatorId,
      eventType: "channel.created",
      entityType: "channel",
      entityId: id,
      payload: { channel }
    });
    return channel;
  }

  listChannelsForNode(accountId, { limit = 50 } = {}) {
    const pageLimit = parsePageLimit(limit, 50);
    const rows = this.db
      .prepare(
        `SELECT DISTINCT c.id
         FROM channels c
         LEFT JOIN channel_members cm ON cm.channel_id = c.id AND cm.account_id = ?
         WHERE c.archived_at IS NULL AND (c.visibility = 'public' OR cm.account_id IS NOT NULL)
         ORDER BY c.updated_at DESC
         LIMIT ?`
      )
      .all(accountId, pageLimit);
    return rows.map((r) => this._hydrateChannel(r.id, accountId));
  }

  joinChannel({ channelId, accountId }) {
    const ch = this.db
      .prepare("SELECT id, visibility FROM channels WHERE id = ? AND archived_at IS NULL")
      .get(channelId);
    if (!ch) throw makeError(404, "channel_not_found", "Channel not found.");
    if (ch.visibility === "private" && !this.getMemberRole(channelId, accountId)) {
      throw makeError(403, "forbidden", "Private channels require an invitation by a moderator or owner.");
    }

    this.db
      .prepare("INSERT OR IGNORE INTO channel_members (channel_id, account_id, role, joined_at) VALUES (?, ?, 'member', ?)")
      .run(channelId, accountId, nowIso());
    return this._hydrateChannel(channelId, accountId);
  }

  addMember({ channelId, actorId, targetNodeId, role = "member" }) {
    const actorRole = this.getMemberRole(channelId, actorId);
    if (actorRole !== "owner" && actorRole !== "moderator") {
      throw makeError(403, "forbidden", "Only channel owners or moderators can invite members.");
    }
    const target = this.db.prepare("SELECT id, status FROM accounts WHERE id = ?").get(targetNodeId);
    if (!target || target.status !== "active") {
      throw makeError(404, "node_not_found", "Target Node not found.");
    }
    const safeRole = ["moderator", "member"].includes(role) ? role : "member";
    this.db
      .prepare(
        `INSERT INTO channel_members (channel_id, account_id, role, joined_at)
         VALUES (?, ?, ?, ?)
         ON CONFLICT(channel_id, account_id) DO UPDATE SET role = excluded.role`
      )
      .run(channelId, targetNodeId, safeRole, nowIso());

    const channel = this._hydrateChannel(channelId, targetNodeId);
    this.syncService.appendEvent({
      accountId: targetNodeId,
      eventType: "channel.joined",
      entityType: "channel",
      entityId: channelId,
      payload: { channel }
    });
    return channel;
  }

  leaveChannel({ channelId, accountId }) {
    this.db
      .prepare("DELETE FROM channel_members WHERE channel_id = ? AND account_id = ?")
      .run(channelId, accountId);
    return { left: true, channelId };
  }

  postMessage({ channelId, senderAccountId, senderDeviceId = null, clientMessageId = null, body = "", attachmentId = null }) {
    const role = this.getMemberRole(channelId, senderAccountId);
    if (!role) {
      throw makeError(403, "forbidden", "Join the channel before posting messages.");
    }

    const safeBody = typeof body === "string" ? body : "";
    if (!safeBody.trim() && !attachmentId) {
      throw makeError(400, "validation_error", "Channel message must include body text or an attachmentId.");
    }
    if (safeBody.length > LIMITS.MESSAGE_BODY_MAX) {
      throw makeError(400, "validation_error", `Message body cannot exceed ${LIMITS.MESSAGE_BODY_MAX} characters.`);
    }

    const safeClientId =
      typeof clientMessageId === "string" && clientMessageId.trim().length > 0
        ? clientMessageId.trim().slice(0, 100)
        : null;

    if (safeClientId) {
      const existing = this.db
        .prepare(
          `SELECT cm.*, a.username AS sender_username
           FROM channel_messages cm
           JOIN accounts a ON a.id = cm.sender_account_id
           WHERE cm.channel_id = ? AND cm.sender_account_id = ? AND cm.client_message_id = ?`
        )
        .get(channelId, senderAccountId, safeClientId);
      if (existing) {
        return { message: this._mapMessage(existing), deduplicated: true };
      }
    }

    const id = generateOpaqueId("cmsg");
    const now = nowIso();
    this.db
      .prepare(
        `INSERT INTO channel_messages (
          id, channel_id, sender_account_id, sender_device_id, client_message_id,
          body, attachment_id, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(id, channelId, senderAccountId, senderDeviceId, safeClientId, safeBody, attachmentId, now);
    this.db.prepare("UPDATE channels SET updated_at = ? WHERE id = ?").run(now, channelId);

    const row = this.db
      .prepare(
        `SELECT cm.*, a.username AS sender_username
         FROM channel_messages cm
         JOIN accounts a ON a.id = cm.sender_account_id
         WHERE cm.id = ?`
      )
      .get(id);
    const message = this._mapMessage(row);

    const members = this.db
      .prepare("SELECT account_id FROM channel_members WHERE channel_id = ?")
      .all(channelId)
      .map((r) => r.account_id);

    this.syncService.appendEventForAccounts(members, {
      eventType: "channel.message_created",
      entityType: "channel_message",
      entityId: id,
      payload: { message }
    });

    return { message, deduplicated: false };
  }

  _mapMessage(row) {
    return {
      seq: row.seq,
      id: row.id,
      channelId: row.channel_id,
      senderNodeId: row.sender_account_id,
      senderUsername: row.sender_username,
      senderDeviceId: row.sender_device_id,
      clientMessageId: row.client_message_id,
      body: row.deleted_at ? "" : row.body,
      attachmentId: row.attachment_id,
      createdAt: row.created_at,
      editedAt: row.edited_at,
      deletedAt: row.deleted_at
    };
  }

  listMessages({ channelId, accountId, afterSeq = null, limit = 50 }) {
    if (!this.canReadChannel(channelId, accountId)) {
      throw makeError(403, "forbidden", "Not authorized to read this channel.");
    }
    const pageLimit = parsePageLimit(limit, 50);

    const rows =
      afterSeq !== null && afterSeq !== undefined && Number.isInteger(Number(afterSeq))
        ? this.db
            .prepare(
              `SELECT cm.*, a.username AS sender_username
               FROM channel_messages cm
               JOIN accounts a ON a.id = cm.sender_account_id
               WHERE cm.channel_id = ? AND cm.seq > ?
               ORDER BY cm.seq ASC
               LIMIT ?`
            )
            .all(channelId, Number(afterSeq), pageLimit)
        : this.db
            .prepare(
              `SELECT cm.*, a.username AS sender_username
               FROM channel_messages cm
               JOIN accounts a ON a.id = cm.sender_account_id
               WHERE cm.channel_id = ?
               ORDER BY cm.seq DESC
               LIMIT ?`
            )
            .all(channelId, pageLimit)
            .reverse();

    return rows.map((r) => this._mapMessage(r));
  }

  deleteMessage({ channelId, messageId, accountId }) {
    const role = this.getMemberRole(channelId, accountId);
    const existing = this.db
      .prepare("SELECT * FROM channel_messages WHERE id = ? AND channel_id = ?")
      .get(messageId, channelId);
    if (!existing) throw makeError(404, "message_not_found", "Channel message not found.");
    if (existing.sender_account_id !== accountId && role !== "owner" && role !== "moderator") {
      throw makeError(403, "forbidden", "Not authorized to delete this channel message.");
    }
    const now = nowIso();
    this.db
      .prepare("UPDATE channel_messages SET body = '', deleted_at = COALESCE(deleted_at, ?) WHERE id = ?")
      .run(now, messageId);

    const members = this.db
      .prepare("SELECT account_id FROM channel_members WHERE channel_id = ?")
      .all(channelId)
      .map((r) => r.account_id);
    this.syncService.appendEventForAccounts(members, {
      eventType: "channel.message_deleted",
      entityType: "channel_message",
      entityId: messageId,
      payload: { channelId, messageId, deletedAt: now }
    });
    return { deleted: true, channelId, messageId, deletedAt: now };
  }
}
