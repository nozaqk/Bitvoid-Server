import { sendError, sendSuccess } from "./errorEnvelope.js";

export function registerChannelRoutes(app, ctx) {
  const { channelService, authenticate } = ctx;

  app.post("/api/v1/channels", { preHandler: authenticate }, async (request, reply) => {
    const body = request.body || {};
    const channel = channelService.createChannel({
      creatorId: request.account.id,
      slug: body.slug,
      name: body.name,
      description: body.description ?? "",
      visibility: body.visibility ?? "public"
    });
    return sendSuccess(reply, { channel }, 201);
  });

  app.get("/api/v1/channels", { preHandler: authenticate }, async (request, reply) => {
    const channels = channelService.listChannelsForNode(request.account.id, {
      limit: request.query?.limit
    });
    return sendSuccess(reply, { channels });
  });

  app.post("/api/v1/channels/:channelId/join", { preHandler: authenticate }, async (request, reply) => {
    const channel = channelService.joinChannel({
      channelId: request.params.channelId,
      accountId: request.account.id
    });
    return sendSuccess(reply, { channel });
  });

  app.post("/api/v1/channels/:channelId/members", { preHandler: authenticate }, async (request, reply) => {
    const body = request.body || {};
    const targetNodeId = body.nodeId || body.accountId;
    if (!targetNodeId) {
      return sendError(reply, 400, "validation_error", "nodeId is required.");
    }
    const channel = channelService.addMember({
      channelId: request.params.channelId,
      actorId: request.account.id,
      targetNodeId,
      role: body.role || "member"
    });
    return sendSuccess(reply, { channel });
  });

  app.post("/api/v1/channels/:channelId/leave", { preHandler: authenticate }, async (request, reply) => {
    const result = channelService.leaveChannel({
      channelId: request.params.channelId,
      accountId: request.account.id
    });
    return sendSuccess(reply, result);
  });

  app.post("/api/v1/channels/:channelId/messages", { preHandler: authenticate }, async (request, reply) => {
    const body = request.body || {};
    const result = channelService.postMessage({
      channelId: request.params.channelId,
      senderAccountId: request.account.id,
      senderDeviceId: request.device?.id || null,
      clientMessageId: body.clientMessageId || request.headers["idempotency-key"] || null,
      body: body.body ?? "",
      attachmentId: body.attachmentId ?? null
    });
    return sendSuccess(
      reply,
      { message: result.message, deduplicated: result.deduplicated },
      result.deduplicated ? 200 : 201
    );
  });

  app.get("/api/v1/channels/:channelId/messages", { preHandler: authenticate }, async (request, reply) => {
    const messages = channelService.listMessages({
      channelId: request.params.channelId,
      accountId: request.account.id,
      afterSeq: request.query?.afterSeq ?? null,
      limit: request.query?.limit
    });
    return sendSuccess(reply, { messages });
  });

  app.delete(
    "/api/v1/channels/:channelId/messages/:messageId",
    { preHandler: authenticate },
    async (request, reply) => {
      const result = channelService.deleteMessage({
        channelId: request.params.channelId,
        messageId: request.params.messageId,
        accountId: request.account.id
      });
      return sendSuccess(reply, result);
    }
  );
}
