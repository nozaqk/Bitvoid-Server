import { sendError, sendSuccess } from "./errorEnvelope.js";

export function registerAttachmentRoutes(app, ctx) {
  const { attachmentService, authenticate } = ctx;

  // Streaming multipart file upload.
  app.post("/api/v1/attachments", { preHandler: authenticate }, async (request, reply) => {
    const part = await request.file();
    if (!part) {
      return sendError(reply, 400, "validation_error", "Multipart file upload is required.");
    }

    const scopeType =
      request.query?.scopeType ||
      part.fields?.scopeType?.value ||
      "personal";
    const scopeId =
      request.query?.scopeId ||
      part.fields?.scopeId?.value ||
      null;

    const attachment = await attachmentService.storeUploadedStream({
      accountId: request.account.id,
      deviceId: request.device?.id || null,
      scopeType: String(scopeType),
      scopeId: scopeId ? String(scopeId) : null,
      originalFilename: part.filename,
      mimeType: part.mimetype,
      stream: part.file
    });

    return sendSuccess(reply, { attachment }, 201);
  });

  app.get("/api/v1/attachments/:attachmentId", { preHandler: authenticate }, async (request, reply) => {
    const attachment = attachmentService.getMetadataForNode(
      request.params.attachmentId,
      request.account.id
    );
    if (!attachment) {
      return sendError(reply, 404, "attachment_not_found", "Attachment not found.");
    }
    return sendSuccess(reply, { attachment });
  });

  app.get("/api/v1/attachments/:attachmentId/download", { preHandler: authenticate }, async (request, reply) => {
    const result = attachmentService.openDownloadStream(
      request.params.attachmentId,
      request.account.id
    );
    if (!result) {
      return sendError(reply, 404, "attachment_not_found", "Attachment not found.");
    }

    reply.header("X-Content-Type-Options", "nosniff");
    reply.header("Content-Type", result.metadata.mimeType || "application/octet-stream");
    reply.header("Content-Length", String(result.sizeBytes));
    reply.header(
      "Content-Disposition",
      `attachment; filename="${result.metadata.filename.replace(/"/g, "_")}"`
    );
    reply.header("ETag", `"${result.metadata.sha256}"`);
    return reply.send(result.stream);
  });

  app.delete("/api/v1/attachments/:attachmentId", { preHandler: authenticate }, async (request, reply) => {
    const deleted = attachmentService.deleteAttachment(
      request.params.attachmentId,
      request.account.id
    );
    if (!deleted) {
      return sendError(reply, 404, "attachment_not_found", "Attachment not found.");
    }
    return sendSuccess(reply, { deleted });
  });
}
