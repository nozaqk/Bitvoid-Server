import { sendError, sendSuccess } from "./errorEnvelope.js";

export function registerMessagingRoutes(app, ctx) {
  const { messagingService, authenticate } = ctx;

  // Create a direct or group conversation.
  app.post("/api/v1/conversations", { preHandler: authenticate }, async (request, reply) => {
    const body = request.body || {};
    const type = body.type || (body.peerNodeId || body.peerAccountId ? "direct" : "group");
    const memberIds = Array.isArray(body.memberIds)
      ? body.memberIds
      : body.peerNodeId || body.peerAccountId
        ? [body.peerNodeId || body.peerAccountId]
        : [];

    const result = messagingService.createConversation({
      creatorId: request.account.id,
      type,
      title: body.title ?? null,
      memberIds
    });

    return sendSuccess(
      reply,
      { conversation: result.conversation, created: result.created },
      result.created ? 201 : 200
    );
  });

  // List conversations for the authenticated Node.
  app.get("/api/v1/conversations", { preHandler: authenticate }, async (request, reply) => {
    const conversations = messagingService.listConversationsForNode(request.account.id, {
      limit: request.query?.limit
    });
    return sendSuccess(reply, { conversations });
  });

  // Get conversation details & members.
  app.get("/api/v1/conversations/:conversationId", { preHandler: authenticate }, async (request, reply) => {
    const conversation = messagingService.getConversationForNode(
      request.params.conversationId,
      request.account.id
    );
    return sendSuccess(reply, { conversation });
  });

  // Add member to group conversation.
  app.post(
    "/api/v1/conversations/:conversationId/members",
    { preHandler: authenticate },
    async (request, reply) => {
      const body = request.body || {};
      const targetNodeId = body.nodeId || body.accountId;
      if (!targetNodeId) {
        return sendError(reply, 400, "validation_error", "nodeId is required.");
      }
      const conversation = messagingService.addGroupMember({
        conversationId: request.params.conversationId,
        actorId: request.account.id,
        targetNodeId
      });
      return sendSuccess(reply, { conversation });
    }
  );

  // Remove member from group conversation (or leave).
  app.delete(
    "/api/v1/conversations/:conversationId/members/:nodeId",
    { preHandler: authenticate },
    async (request, reply) => {
      const result = messagingService.removeGroupMember({
        conversationId: request.params.conversationId,
        actorId: request.account.id,
        targetNodeId: request.params.nodeId
      });
      return sendSuccess(reply, result);
    }
  );

  // Send message (supports clientMessageId or Idempotency-Key header for safe offline retries).
  app.post(
    "/api/v1/conversations/:conversationId/messages",
    { preHandler: authenticate },
    async (request, reply) => {
      const body = request.body || {};
      const idempotencyKey =
        body.clientMessageId ||
        request.headers["idempotency-key"] ||
        null;

      const result = messagingService.sendMessage({
        conversationId: request.params.conversationId,
        senderAccountId: request.account.id,
        senderDeviceId: request.device?.id || null,
        clientMessageId: idempotencyKey,
        kind: body.kind || (body.attachmentId && !body.body ? "attachment" : "text"),
        body: body.body ?? "",
        replyToMessageId: body.replyToMessageId ?? null,
        attachmentId: body.attachmentId ?? null
      });

      return sendSuccess(
        reply,
        { message: result.message, deduplicated: result.deduplicated },
        result.deduplicated ? 200 : 201
      );
    }
  );

  // List messages in a conversation (supports beforeSeq / afterSeq cursor pagination).
  app.get(
    "/api/v1/conversations/:conversationId/messages",
    { preHandler: authenticate },
    async (request, reply) => {
      const messages = messagingService.listMessages({
        conversationId: request.params.conversationId,
        accountId: request.account.id,
        beforeSeq: request.query?.beforeSeq ?? null,
        afterSeq: request.query?.afterSeq ?? null,
        limit: request.query?.limit
      });
      return sendSuccess(reply, { messages });
    }
  );

  // Edit own message.
  app.patch(
    "/api/v1/conversations/:conversationId/messages/:messageId",
    { preHandler: authenticate },
    async (request, reply) => {
      const body = request.body || {};
      const message = messagingService.editMessage({
        conversationId: request.params.conversationId,
        messageId: request.params.messageId,
        accountId: request.account.id,
        body: body.body
      });
      return sendSuccess(reply, { message });
    }
  );

  // Soft-delete message (creates tombstone and fans out delete event).
  app.delete(
    "/api/v1/conversations/:conversationId/messages/:messageId",
    { preHandler: authenticate },
    async (request, reply) => {
      const result = messagingService.deleteMessage({
        conversationId: request.params.conversationId,
        messageId: request.params.messageId,
        accountId: request.account.id
      });
      return sendSuccess(reply, result);
    }
  );

  // Update delivery or read receipt for a message.
  app.post(
    "/api/v1/conversations/:conversationId/messages/:messageId/receipts",
    { preHandler: authenticate },
    async (request, reply) => {
      const body = request.body || {};
      const receipt = messagingService.updateReceipt({
        conversationId: request.params.conversationId,
        messageId: request.params.messageId,
        accountId: request.account.id,
        status: body.status
      });
      return sendSuccess(reply, { receipt });
    }
  );
}
