import { sendError, sendSuccess } from "./errorEnvelope.js";

export function registerSyncRoutes(app, ctx) {
  const { syncService, messagingService, channelService, authenticate } = ctx;

  // Pull durable ordered events after cursor (for offline reconnect & multi-device sync).
  app.get("/api/v1/sync/events", { preHandler: authenticate }, async (request, reply) => {
    let afterSeq = request.query?.afterSeq;
    if (afterSeq === undefined || afterSeq === null || afterSeq === "") {
      const saved = syncService.getDeviceCursor({
        deviceId: request.device?.id,
        accountId: request.account.id
      });
      afterSeq = saved.lastSeq;
    }

    const result = syncService.pullEvents({
      accountId: request.account.id,
      afterSeq: Number(afterSeq) || 0,
      limit: request.query?.limit
    });

    return sendSuccess(reply, result);
  });

  // Acknowledge per-device sync cursor.
  app.post("/api/v1/sync/cursor", { preHandler: authenticate }, async (request, reply) => {
    const body = request.body || {};
    if (!request.device?.id) {
      return sendError(
        reply,
        400,
        "device_required",
        "A device-associated session is required to persist a sync cursor."
      );
    }
    if (!Number.isInteger(body.lastSeq) || body.lastSeq < 0) {
      return sendError(reply, 400, "validation_error", "lastSeq must be a non-negative integer.");
    }

    const cursor = syncService.ackDeviceCursor({
      deviceId: request.device.id,
      accountId: request.account.id,
      lastSeq: body.lastSeq
    });
    return sendSuccess(reply, { cursor });
  });

  // Flush offline outbox operations in a single batch with idempotent deduplication.
  app.post("/api/v1/sync/outbox", { preHandler: authenticate }, async (request, reply) => {
    const body = request.body || {};
    const operations = Array.isArray(body.operations) ? body.operations : null;
    if (!operations || operations.length === 0 || operations.length > 100) {
      return sendError(
        reply,
        400,
        "validation_error",
        "operations must be a non-empty array of 1-100 queued operations."
      );
    }

    const results = [];
    for (const op of operations) {
      try {
        if (op.type === "conversation.message") {
          const sent = messagingService.sendMessage({
            conversationId: op.conversationId,
            senderAccountId: request.account.id,
            senderDeviceId: request.device?.id || null,
            clientMessageId: op.clientMessageId || null,
            kind: op.kind || "text",
            body: op.body ?? "",
            replyToMessageId: op.replyToMessageId ?? null,
            attachmentId: op.attachmentId ?? null
          });
          results.push({
            clientMessageId: op.clientMessageId || null,
            ok: true,
            deduplicated: sent.deduplicated,
            message: sent.message
          });
        } else if (op.type === "channel.message") {
          const sent = channelService.postMessage({
            channelId: op.channelId,
            senderAccountId: request.account.id,
            senderDeviceId: request.device?.id || null,
            clientMessageId: op.clientMessageId || null,
            body: op.body ?? "",
            attachmentId: op.attachmentId ?? null
          });
          results.push({
            clientMessageId: op.clientMessageId || null,
            ok: true,
            deduplicated: sent.deduplicated,
            message: sent.message
          });
        } else if (op.type === "message.receipt") {
          const receipt = messagingService.updateReceipt({
            conversationId: op.conversationId,
            messageId: op.messageId,
            accountId: request.account.id,
            status: op.status
          });
          results.push({
            clientMessageId: op.clientMessageId || null,
            ok: true,
            receipt
          });
        } else {
          results.push({
            clientMessageId: op.clientMessageId || null,
            ok: false,
            error: { code: "unsupported_operation", message: `Unsupported outbox type: ${op.type}` }
          });
        }
      } catch (err) {
        results.push({
          clientMessageId: op.clientMessageId || null,
          ok: false,
          error: { code: err.code || "operation_failed", message: err.message }
        });
      }
    }

    return sendSuccess(reply, { results });
  });
}
