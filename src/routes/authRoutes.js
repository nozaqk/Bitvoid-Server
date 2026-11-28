import { sendError, sendSuccess } from "./errorEnvelope.js";
import { isValidDeviceTrustStatus, isValidOpaqueId } from "../security/validation.js";

export function registerAuthRoutes(app, ctx) {
  const { deviceService, sessionService, authenticate } = ctx;

  // Rotate refresh token into a new access + refresh token pair.
  app.post(
    "/api/v1/auth/refresh",
    { config: { rateLimit: { max: 20, timeWindow: "1 minute" } } },
    async (request, reply) => {
      const body = request.body || {};
      const result = sessionService.refreshSession({
        refreshToken: body.refreshToken,
        ipAddress: request.ip,
        userAgent: request.headers["user-agent"] || null,
        requestId: request.id
      });
      if (!result.ok) {
        return sendError(reply, result.status, result.code, result.message);
      }
      return sendSuccess(reply, {
        account: result.account,
        token: result.session.token,
        refreshToken: result.session.refreshToken,
        expiresAt: result.session.expiresAt,
        refreshExpiresAt: result.session.refreshExpiresAt,
        deviceId: result.session.deviceId
      });
    }
  );

  // Revoke current session (preserves exact v1 response `{ data: { revoked: true }, meta }`).
  app.post("/api/v1/auth/revoke", { preHandler: authenticate }, async (request, reply) => {
    const result = sessionService.revokeSession({
      sessionId: request.sessionId,
      accountId: request.account.id,
      actorType: "node",
      actorId: request.account.id,
      reason: "user_logout",
      ipAddress: request.ip,
      requestId: request.id
    });
    return sendSuccess(reply, {
      revoked: true,
      sessionId: request.sessionId,
      disconnectedSockets: result?.disconnectedSockets || 0
    });
  });

  // Revoke all other sessions for the authenticated Node.
  app.post("/api/v1/auth/revoke-others", { preHandler: authenticate }, async (request, reply) => {
    const result = sessionService.revokeOtherSessions({
      accountId: request.account.id,
      keepSessionId: request.sessionId,
      reason: "user_revoke_others",
      ipAddress: request.ip,
      requestId: request.id
    });
    return sendSuccess(reply, result);
  });

  // List sessions belonging to the authenticated Node.
  app.get("/api/v1/sessions", { preHandler: authenticate }, async (request, reply) => {
    const sessions = sessionService.listSessionsForAccount(
      request.account.id,
      request.sessionId
    );
    return sendSuccess(reply, { sessions });
  });

  // Revoke a specific session belonging to the authenticated Node.
  app.delete("/api/v1/sessions/:sessionId", { preHandler: authenticate }, async (request, reply) => {
    const { sessionId } = request.params;
    const result = sessionService.revokeSession({
      sessionId,
      accountId: request.account.id,
      actorType: "node",
      actorId: request.account.id,
      reason: "user_revoked_session",
      ipAddress: request.ip,
      requestId: request.id
    });
    if (!result) {
      return sendError(reply, 404, "session_not_found", "Session not found for this account.");
    }
    return sendSuccess(reply, result);
  });

  // Enroll or refresh a device for the authenticated Node.
  app.post("/api/v1/devices", { preHandler: authenticate }, async (request, reply) => {
    const body = request.body || {};
    const device = deviceService.registerOrTouchDevice({
      accountId: request.account.id,
      deviceId: body.deviceId || null,
      displayName: body.displayName || body.deviceName || "AirMesh Client",
      platform: body.platform || "unknown",
      appVersion: body.appVersion || null,
      deviceFingerprint: body.deviceFingerprint || body.fingerprint || null,
      publicKey: body.publicKey || null
    });
    return sendSuccess(reply, { device }, 201);
  });

  // List devices owned by the authenticated Node.
  app.get("/api/v1/devices", { preHandler: authenticate }, async (request, reply) => {
    const devices = deviceService.listDevicesForAccount(request.account.id);
    return sendSuccess(reply, { devices });
  });

  // Update a device's display name or trust state (Node owner only).
  app.patch("/api/v1/devices/:deviceId", { preHandler: authenticate }, async (request, reply) => {
    const { deviceId } = request.params;
    if (!isValidOpaqueId(deviceId, "dev")) {
      return sendError(reply, 400, "validation_error", "Invalid device ID.");
    }
    const body = request.body || {};
    if (body.trustStatus !== undefined && !isValidDeviceTrustStatus(body.trustStatus)) {
      return sendError(reply, 400, "validation_error", "Invalid device trustStatus.");
    }
    const updated = deviceService.updateDevice({
      deviceId,
      accountId: request.account.id,
      displayName: body.displayName,
      trustStatus: body.trustStatus,
      actorType: "node",
      actorId: request.account.id
    });
    if (!updated) {
      return sendError(reply, 404, "device_not_found", "Device not found for this account.");
    }
    return sendSuccess(reply, { device: updated });
  });

  // Revoke a device (revokes all sessions on that device and closes its WebSockets immediately).
  app.delete("/api/v1/devices/:deviceId", { preHandler: authenticate }, async (request, reply) => {
    const { deviceId } = request.params;
    if (!isValidOpaqueId(deviceId, "dev")) {
      return sendError(reply, 400, "validation_error", "Invalid device ID.");
    }
    const revoked = deviceService.revokeDevice({
      deviceId,
      accountId: request.account.id,
      actorType: "node",
      actorId: request.account.id,
      reason: "user_revoked_device"
    });
    if (!revoked) {
      return sendError(reply, 404, "device_not_found", "Device not found for this account.");
    }
    return sendSuccess(reply, { device: revoked });
  });
}
