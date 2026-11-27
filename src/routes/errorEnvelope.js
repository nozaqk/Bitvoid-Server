import { nowIso } from "../security/crypto.js";

export function sendError(reply, status, code, message, extra = undefined) {
  const errorBody = { code, message };
  if (extra && typeof extra === "object") {
    Object.assign(errorBody, extra);
  }
  return reply.code(status).send({
    error: errorBody,
    meta: {
      requestId: reply.request.id,
      serverTime: nowIso()
    }
  });
}

export function sendSuccess(reply, data, status = 200) {
  return reply.code(status).send({
    data,
    meta: {
      requestId: reply.request.id,
      serverTime: nowIso()
    }
  });
}

export function registerErrorHandler(app, logService) {
  app.setErrorHandler((err, request, reply) => {
    const statusCode =
      Number.isInteger(err.statusCode) && err.statusCode >= 400 && err.statusCode < 600
        ? err.statusCode
        : 500;

    if (logService) {
      logService.write({
        level: statusCode >= 500 ? "error" : "warn",
        component: "http",
        eventCode: statusCode >= 500 ? "http.internal_error" : "http.request_error",
        requestId: request.id,
        message: err.message || "Unhandled error",
        context: { statusCode, method: request.method, url: request.url, code: err.code }
      });
    }

    if (reply.sent) return;

    if (statusCode === 429) {
      return sendError(
        reply,
        429,
        "rate_limited",
        "Too many requests. Please slow down and try again."
      );
    }

    if (err.code === "FST_REQ_FILE_TOO_LARGE" || statusCode === 413) {
      return sendError(
        reply,
        413,
        "payload_too_large",
        "The request or uploaded file exceeds the configured Server limit."
      );
    }

    if (statusCode >= 400 && statusCode < 500) {
      return sendError(
        reply,
        statusCode,
        err.code && typeof err.code === "string" && !err.code.startsWith("FST_")
          ? err.code
          : "request_error",
        err.message || "The request could not be processed."
      );
    }

    return sendError(
      reply,
      500,
      "internal_error",
      "The Server could not complete the request."
    );
  });

  app.setNotFoundHandler((request, reply) => {
    return sendError(reply, 404, "not_found", `Route ${request.method} ${request.url} was not found.`);
  });
}
