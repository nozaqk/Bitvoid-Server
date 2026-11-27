import { sendError } from "./errorEnvelope.js";

export function extractBearerToken(authorizationHeader) {
  if (typeof authorizationHeader !== "string") return null;
  if (!authorizationHeader.startsWith("Bearer ")) return null;
  const token = authorizationHeader.slice(7).trim();
  return token.length > 0 ? token : null;
}

export function createAuthenticatePreHandler(sessionService) {
  return async function authenticate(request, reply) {
    const token = extractBearerToken(request.headers.authorization);
    if (!token) {
      return sendError(
        reply,
        401,
        "unauthenticated",
        "A valid account session is required."
      );
    }

    const result = sessionService.verifyAccessToken(token, { touch: true });
    if (!result.ok) {
      const status = result.code === "account_suspended" ? 403 : 401;
      return sendError(reply, status, result.code, result.message);
    }

    request.account = result.account;
    request.device = result.device;
    request.sessionId = result.sessionId;
    request.sessionExpiresAt = result.expiresAt;
  };
}

/**
 * Measure authenticated HTTP ingress & egress bytes accurately per Node (account).
 */
export function registerTrafficAccountingHooks(app, metricsService) {
  app.addHook("onRequest", async (request) => {
    const contentLength = Number.parseInt(String(request.headers["content-length"] || "0"), 10);
    request._rxBytes = Number.isFinite(contentLength) && contentLength > 0 ? contentLength : 0;
  });

  app.addHook("onSend", async (request, reply, payload) => {
    let txBytes = 0;
    if (typeof payload === "string") {
      txBytes = Buffer.byteLength(payload, "utf8");
    } else if (Buffer.isBuffer(payload)) {
      txBytes = payload.length;
    } else if (payload && typeof payload.byteLength === "number") {
      txBytes = payload.byteLength;
    } else {
      const cl = Number.parseInt(String(reply.getHeader("content-length") || "0"), 10);
      if (Number.isFinite(cl) && cl > 0) txBytes = cl;
    }

    const accountId = request.account?.id || null;
    metricsService.recordHttpTraffic(accountId, request._rxBytes || 0, txBytes);
    return payload;
  });
}
