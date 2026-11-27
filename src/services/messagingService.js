import { LIMITS } from "../config/constants.js";
import { generateOpaqueId, nowIso } from "../security/crypto.js";
import { parsePageLimit } from "../security/validation.js";

function makeError(statusCode, code, message) {
  const err = new Error(message);
  err.statusCode = statusCode;
  err.code = code;
  return err;
}

export class MessagingService {
  constructor({ db, syncService, eventHub = null }) {
    this.db = db;
    this.syncService = syncService;
    this.eventHub = eventHub;
  }

  isMember(conversationId, accountId) {
    const row = this.db
      .prepare("SELECT role FROM conversation_members WHERE conversation_id = ? AND account_id = ?")
      .get(conversationId, accountId);
    return row ? row.role : null;
  }

  _requireMember(conversationId, accountId) {
    const role = this.isMember(conversationId, accountId);
    if (!role) {
      throw makeError(403, "forbidden", "You are not a member of this conversation.");
    }
    return role;
  }

  _getMemberIds(conversationId) {
    return this.db
      .prepare("SELECT account_id FROM conversation_members WHERE conversation_id = ?")
      .all(conversationId)
      .map((r) => r.account_id);
  }

  _hydrateConversation(conversationId) {
    const conv = this.db.prepare("SELECT * FROM conversations WHERE id = ?").get(conversationId);
    if (!conv) return null;

    const members = this.db
      .prepare(
        `SELECT cm.account_id, cm.role, cm.joined_at, cm.last_read_message_id,
                a.username, a.display_name
         FROM conversation_members cm
         JOIN accounts a ON a.id = cm.account_id
         WHERE cm.conversation_id = ?
         ORDER BY cm.joined_at ASC`
      )
      .all(conversationId)
      .map((m) => ({
        nodeId: m.account_id,
        username: m.username,
        displayName: m.display_name || m.username,
        role: m.role,
        joinedAt: m.joined_at,
        lastReadMessageId: m.last_read_message_id
      }));

    const lastMsg = this.db
      .prepare(
        `SELECT id, sender_account_id, kind, body, attachment_id, created_at, edited_at, deleted_at
         FROM messages
         WHERE conversation_id = ?
         ORDER BY seq DESC
         LIMIT 1`
      )
      .get(conversationId);

    return {
      id: conv.id,
      type: conv.type,
      title: conv.title,
      createdBy: conv.created_by,
      createdAt: conv.created_at,
      updatedAt: conv.updated_at,
      members,
      lastMessage: lastMsg
        ? {
            id: lastMsg.id,
            senderNodeId: lastMsg.sender_account_id,
            kind: lastMsg.kind,
            body: lastMsg.deleted_at ? "" : lastMsg.body,
            attachmentId: lastMsg.attachment_id,
            createdAt: lastMsg.created_at,
            editedAt: lastMsg.edited_at,
            deletedAt: lastMsg.deleted_at
          }
        : null
    };
  }

  createConversation({ creatorId, type = "direct", title = null, memberIds = [] }) {
    if (type !== "direct" && type !== "group") {
      throw makeError(400, "validation_error", "Conversation type must be 'direct' or 'group'.");
    }

    const uniqueMembers = [...new Set([creatorId, ...(Array.isArray(memberIds) ? memberIds : [])])];

    // Verify all referenced accounts exist and are active.
    for (const id of uniqueMembers) {
      const acc = this.db.prepare("SELECT id, status FROM accounts WHERE id = ?").get(id);
      if (!acc || acc.status !== "active") {
        throw makeError(404, "node_not_found", `Active Node not found: ${id}`);
      }
    }

    if (type === "direct") {
      if (uniqueMembers.length !== 2) {
        throw makeError(
          400,
          "validation_error",
          "Direct conversations require exactly one distinct peer Node."
        );
      }
      const sortedKey = [...uniqueMembers].sort().join(":");
      const existing = this.db
        .prepare("SELECT id FROM conversations WHERE direct_key = ?")
        .get(sortedKey);
      if (existing) {
        return { conversation: this._hydrateConversation(existing.id), created: false };
      }

      const id = generateOpaqueId("cnv");
      const now = nowIso();
      const tx = this.db.transaction(() => {
        this.db
          .prepare(
            `INSERT INTO conversations (id, type, title, direct_key, created_by, created_at, updated_at)
             VALUES (?, 'direct', NULL, ?, ?, ?, ?)`
          )
          .run(id, sortedKey, creatorId, now, now);
        const insMember = this.db.prepare(
          "INSERT INTO conversation_members (conversation_id, account_id, role, joined_at) VALUES (?, ?, 'member', ?)"
        );
        for (const memberId of uniqueMembers) {
          insMember.run(id, memberId, now);
        }
      });
      tx();

      const hydrated = this._hydrateConversation(id);
      this.syncService.appendEventForAccounts(uniqueMembers, {
        eventType: "conversation.created",
        entityType: "conversation",
        entityId: id,
        payload: { conversation: hydrated }
      });
      return { conversation: hydrated, created: true };
    }

    // Group conversation
    if (typeof title !== "string" || title.trim().length < 1 || title.trim().length > LIMITS.CONVERSATION_TITLE_MAX) {
      throw makeError(
        400,
        "validation_error",
        `Group conversation title must be 1-${LIMITS.CONVERSATION_TITLE_MAX} characters.`
      );
    }

    const id = generateOpaqueId("cnv");
    const now = nowIso();
    const cleanTitle = title.trim();
    const tx = this.db.transaction(() => {
      this.db
        .prepare(
          `INSERT INTO conversations (id, type, title, direct_key, created_by, created_at, updated_at)
           VALUES (?, 'group', ?, NULL, ?, ?, ?)`
        )
        .run(id, cleanTitle, creatorId, now, now);
      const insMember = this.db.prepare(
        "INSERT INTO conversation_members (conversation_id, account_id, role, joined_at) VALUES (?, ?, ?, ?)"
      );
      for (const memberId of uniqueMembers) {
        insMember.run(id, memberId, memberId === creatorId ? "owner" : "member", now);
      }
    });
    tx();

    const hydrated = this._hydrateConversation(id);
    this.syncService.appendEventForAccounts(uniqueMembers, {
      eventType: "conversation.created",
      entityType: "conversation",
      entityId: id,
      payload: { conversation: hydrated }
    });
    return { conversation: hydrated, created: true };
  }

  listConversationsForNode(accountId, { limit = 50 } = {}) {
    const pageLimit = parsePageLimit(limit, 50);
    const rows = this.db
      .prepare(
        `SELECT c.id
         FROM conversations c
         JOIN conversation_members cm ON cm.conversation_id = c.id
         WHERE cm.account_id = ? AND c.archived_at IS NULL
         ORDER BY c.updated_at DESC
         LIMIT ?`
      )
      .all(accountId, pageLimit);

    return rows.map((r) => this._hydrateConversation(r.id));
  }

  getConversationForNode(conversationId, accountId) {
    this._requireMember(conversationId, accountId);
    return this._hydrateConversation(conversationId);
  }

  addGroupMember({ conversationId, actorId, targetNodeId }) {
    const role = this._requireMember(conversationId, actorId);
    const conv = this.db.prepare("SELECT type FROM conversations WHERE id = ?").get(conversationId);
    if (!conv || conv.type !== "group") {
      throw makeError(400, "validation_error", "Members can only be added to group conversations.");
    }
    if (role !== "owner" && role !== "admin") {
      throw makeError(403, "forbidden", "Only group owners or admins can add members.");
    }
    const target = this.db.prepare("SELECT id, status FROM accounts WHERE id = ?").get(targetNodeId);
    if (!target || target.status !== "active") {
      throw makeError(404, "node_not_found", "Target Node not found.");
    }

    const now = nowIso();
    this.db
      .prepare(
        "INSERT OR IGNORE INTO conversation_members (conversation_id, account_id, role, joined_at) VALUES (?, ?, 'member', ?)"
      )
      .run(conversationId, targetNodeId, now);
    this.db.prepare("UPDATE conversations SET updated_at = ? WHERE id = ?").run(now, conversationId);

    const hydrated = this._hydrateConversation(conversationId);
    const memberIds = this._getMemberIds(conversationId);
    this.syncService.appendEventForAccounts(memberIds, {
      eventType: "conversation.member_added",
      entityType: "conversation",
      entityId: conversationId,
      payload: { conversationId, addedNodeId: targetNodeId, conversation: hydrated }
    });
    return hydrated;
  }

  removeGroupMember({ conversationId, actorId, targetNodeId }) {
    const role = this._requireMember(conversationId, actorId);
    const conv = this.db.prepare("SELECT type FROM conversations WHERE id = ?").get(conversationId);
    if (!conv || conv.type !== "group") {
      throw makeError(400, "validation_error", "Members can only be removed from group conversations.");
    }
    if (actorId !== targetNodeId && role !== "owner" && role !== "admin") {
      throw makeError(403, "forbidden", "Only group owners/admins can remove other members.");
    }

    const memberIdsBefore = this._getMemberIds(conversationId);
    this.db
      .prepare("DELETE FROM conversation_members WHERE conversation_id = ? AND account_id = ?")
      .run(conversationId, targetNodeId);
    this.db
      .prepare("UPDATE conversations SET updated_at = ? WHERE id = ?")
      .run(nowIso(), conversationId);

    this.syncService.appendEventForAccounts(memberIdsBefore, {
      eventType: "conversation.member_removed",
      entityType: "conversation",
      entityId: conversationId,
      payload: { conversationId, removedNodeId: targetNodeId }
    });
    return { removed: true, conversationId, removedNodeId: targetNodeId };
  }

  _hydrateMessage(row) {
    if (!row) return null;
    const receipts = this.db
      .prepare("SELECT account_id, delivered_at, read_at FROM message_receipts WHERE message_id = ?")
      .all(row.id)
      .map((r) => ({
        nodeId: r.account_id,
        deliveredAt: r.delivered_at,
        readAt: r.read_at
      }));

    return {
      seq: row.seq,
      id: row.id,
      conversationId: row.conversation_id,
      senderNodeId: row.sender_account_id,
      senderUsername: row.sender_username || undefined,
      senderDeviceId: row.sender_device_id,
      clientMessageId: row.client_message_id,
      kind: row.kind,
      body: row.deleted_at ? "" : row.body,
      replyToMessageId: row.reply_to_message_id,
      attachmentId: row.attachment_id,
      createdAt: row.created_at,
      editedAt: row.edited_at,
      deletedAt: row.deleted_at,
      receipts
    };
  }

  sendMessage({
    conversationId,
    senderAccountId,
    senderDeviceId = null,
    clientMessageId = null,
    kind = "text",
    body = "",
    replyToMessageId = null,
    attachmentId = null
  }) {
    this._requireMember(conversationId, senderAccountId);

    const safeBody = typeof body === "string" ? body : "";
    if (!safeBody.trim() && !attachmentId) {
      throw makeError(400, "validation_error", "Message must include body text or an attachmentId.");
    }
    if (safeBody.length > LIMITS.MESSAGE_BODY_MAX) {
      throw makeError(
        400,
        "validation_error",
        `Message body cannot exceed ${LIMITS.MESSAGE_BODY_MAX} characters.`
      );
    }

    const safeClientId =
      typeof clientMessageId === "string" && clientMessageId.trim().length > 0
        ? clientMessageId.trim().slice(0, 100)
        : null;

    // Idempotent retry handling (critical for offline message queues & mobile reconnects!).
    if (safeClientId) {
      const existing = this.db
        .prepare(
          `SELECT m.*, a.username AS sender_username
           FROM messages m
           JOIN accounts a ON a.id = m.sender_account_id
           WHERE m.conversation_id = ? AND m.sender_account_id = ? AND m.client_message_id = ?`
        )
        .get(conversationId, senderAccountId, safeClientId);
      if (existing) {
        return { message: this._hydrateMessage(existing), deduplicated: true };
      }
    }

    if (attachmentId) {
      const att = this.db
        .prepare("SELECT id FROM attachments WHERE id = ? AND deleted_at IS NULL")
        .get(attachmentId);
      if (!att) {
        throw makeError(404, "attachment_not_found", "Referenced attachment not found.");
      }
    }

    const id = generateOpaqueId("msg");
    const now = nowIso();
    const safeKind = ["text", "attachment", "system"].includes(kind) ? kind : "text";

    const tx = this.db.transaction(() => {
      this.db
        .prepare(
          `INSERT INTO messages (
            id, conversation_id, sender_account_id, sender_device_id, client_message_id,
            kind, body, reply_to_message_id, attachment_id, created_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .run(
          id,
          conversationId,
          senderAccountId,
          senderDeviceId,
          safeClientId,
          safeKind,
          safeBody,
          replyToMessageId,
          attachmentId,
          now
        );
      this.db.prepare("UPDATE conversations SET updated_at = ? WHERE id = ?").run(now, conversationId);
      this.db
        .prepare(
          `INSERT OR REPLACE INTO message_receipts (message_id, account_id, delivered_at, read_at)
           VALUES (?, ?, ?, ?)`
        )
        .run(id, senderAccountId, now, now);
    });
    tx();

    const row = this.db
      .prepare(
        `SELECT m.*, a.username AS sender_username
         FROM messages m
         JOIN accounts a ON a.id = m.sender_account_id
         WHERE m.id = ?`
      )
      .get(id);
    const hydrated = this._hydrateMessage(row);

    const memberIds = this._getMemberIds(conversationId);
    this.syncService.appendEventForAccounts(memberIds, {
      eventType: "message.created",
      entityType: "message",
      entityId: id,
      payload: { message: hydrated }
    });

    return { message: hydrated, deduplicated: false };
  }

  listMessages({ conversationId, accountId, beforeSeq = null, afterSeq = null, limit = 50 }) {
    this._requireMember(conversationId, accountId);
    const pageLimit = parsePageLimit(limit, 50);

    let rows;
    if (afterSeq !== null && afterSeq !== undefined && Number.isInteger(Number(afterSeq))) {
      rows = this.db
        .prepare(
          `SELECT m.*, a.username AS sender_username
           FROM messages m
           JOIN accounts a ON a.id = m.sender_account_id
           WHERE m.conversation_id = ? AND m.seq > ?
           ORDER BY m.seq ASC
           LIMIT ?`
        )
        .all(conversationId, Number(afterSeq), pageLimit);
    } else if (beforeSeq !== null && beforeSeq !== undefined && Number.isInteger(Number(beforeSeq))) {
      rows = this.db
        .prepare(
          `SELECT m.*, a.username AS sender_username
           FROM messages m
           JOIN accounts a ON a.id = m.sender_account_id
           WHERE m.conversation_id = ? AND m.seq < ?
           ORDER BY m.seq DESC
           LIMIT ?`
        )
        .all(conversationId, Number(beforeSeq), pageLimit)
        .reverse();
    } else {
      rows = this.db
        .prepare(
          `SELECT m.*, a.username AS sender_username
           FROM messages m
           JOIN accounts a ON a.id = m.sender_account_id
           WHERE m.conversation_id = ?
           ORDER BY m.seq DESC
           LIMIT ?`
        )
        .all(conversationId, pageLimit)
        .reverse();
    }

    return rows.map((r) => this._hydrateMessage(r));
  }

  editMessage({ conversationId, messageId, accountId, body }) {
    this._requireMember(conversationId, accountId);
    if (typeof body !== "string" || !body.trim() || body.length > LIMITS.MESSAGE_BODY_MAX) {
      throw makeError(400, "validation_error", "Edited message body is invalid.");
    }
    const existing = this.db
      .prepare("SELECT * FROM messages WHERE id = ? AND conversation_id = ?")
      .get(messageId, conversationId);
    if (!existing || existing.deleted_at) {
      throw makeError(404, "message_not_found", "Message not found.");
    }
    if (existing.sender_account_id !== accountId) {
      throw makeError(403, "forbidden", "Only the message sender can edit this message.");
    }

    const now = nowIso();
    this.db
      .prepare("UPDATE messages SET body = ?, edited_at = ? WHERE id = ?")
      .run(body, now, messageId);

    const updated = this.db
      .prepare(
        `SELECT m.*, a.username AS sender_username
         FROM messages m
         JOIN accounts a ON a.id = m.sender_account_id
         WHERE m.id = ?`
      )
      .get(messageId);
    const hydrated = this._hydrateMessage(updated);

    const memberIds = this._getMemberIds(conversationId);
    this.syncService.appendEventForAccounts(memberIds, {
      eventType: "message.edited",
      entityType: "message",
      entityId: messageId,
      payload: { message: hydrated }
    });

    return hydrated;
  }

  deleteMessage({ conversationId, messageId, accountId }) {
    const role = this._requireMember(conversationId, accountId);
    const existing = this.db
      .prepare("SELECT * FROM messages WHERE id = ? AND conversation_id = ?")
      .get(messageId, conversationId);
    if (!existing) {
      throw makeError(404, "message_not_found", "Message not found.");
    }
    if (existing.sender_account_id !== accountId && role !== "owner" && role !== "admin") {
      throw makeError(403, "forbidden", "Not authorized to delete this message.");
    }

    const now = nowIso();
    this.db
      .prepare("UPDATE messages SET body = '', deleted_at = COALESCE(deleted_at, ?) WHERE id = ?")
      .run(now, messageId);

    const memberIds = this._getMemberIds(conversationId);
    this.syncService.appendEventForAccounts(memberIds, {
      eventType: "message.deleted",
      entityType: "message",
      entityId: messageId,
      payload: { conversationId, messageId, deletedAt: now }
    });

    return { deleted: true, conversationId, messageId, deletedAt: now };
  }

  updateReceipt({ conversationId, messageId, accountId, status }) {
    this._requireMember(conversationId, accountId);
    if (status !== "delivered" && status !== "read") {
      throw makeError(400, "validation_error", "Receipt status must be 'delivered' or 'read'.");
    }
    const msg = this.db
      .prepare("SELECT id FROM messages WHERE id = ? AND conversation_id = ?")
      .get(messageId, conversationId);
    if (!msg) {
      throw makeError(404, "message_not_found", "Message not found.");
    }

    const now = nowIso();
    if (status === "delivered") {
      this.db
        .prepare(
          `INSERT INTO message_receipts (message_id, account_id, delivered_at, read_at)
           VALUES (?, ?, ?, NULL)
           ON CONFLICT(message_id, account_id) DO UPDATE SET
             delivered_at = COALESCE(message_receipts.delivered_at, excluded.delivered_at)`
        )
        .run(messageId, accountId, now);
    } else {
      this.db
        .prepare(
          `INSERT INTO message_receipts (message_id, account_id, delivered_at, read_at)
           VALUES (?, ?, ?, ?)
           ON CONFLICT(message_id, account_id) DO UPDATE SET
             delivered_at = COALESCE(message_receipts.delivered_at, excluded.delivered_at),
             read_at = COALESCE(message_receipts.read_at, excluded.read_at)`
        )
        .run(messageId, accountId, now, now);
      this.db
        .prepare(
          "UPDATE conversation_members SET last_read_message_id = ? WHERE conversation_id = ? AND account_id = ?"
        )
        .run(messageId, conversationId, accountId);
    }

    const receipt = {
      conversationId,
      messageId,
      nodeId: accountId,
      status,
      occurredAt: now
    };
    const memberIds = this._getMemberIds(conversationId);
    this.syncService.appendEventForAccounts(memberIds, {
      eventType: "message.receipt",
      entityType: "message",
      entityId: messageId,
      payload: receipt
    });
    return receipt;
  }
}
