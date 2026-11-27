import { sendError, sendSuccess } from "./errorEnvelope.js";
import { isValidDisplayName } from "../security/validation.js";

export function registerAccountRoutes(app, ctx) {
  const { config, authService, nodeService, authenticate } = ctx;

  // Register a new Node account (preserves exact v1 response keys + adds node/device/refresh fields).
  app.post(
    "/api/v1/account/register",
    { config: { rateLimit: { max: Math.max(5, config.authRateLimitMax), timeWindow: "1 minute" } } },
    async (request, reply) => {
      const body = request.body || {};
      const result = await authService.register({
        username: body.username,
        password: body.password,
        displayName: body.displayName ?? null,
        device: body.device ?? null,
        ipAddress: request.ip,
        userAgent: request.headers["user-agent"] || null,
        requestId: request.id
      });

      if (!result.ok) {
        return sendError(reply, result.status, result.code, result.message);
      }
      return reply.code(result.status).send(result.payload);
    }
  );

  // Login to a Node account (supports transparent legacy bcrypt -> Argon2id upgrade).
  app.post(
    "/api/v1/account/login",
    { config: { rateLimit: { max: Math.max(8, config.authRateLimitMax), timeWindow: "1 minute" } } },
    async (request, reply) => {
      const body = request.body || {};
      const result = await authService.login({
        username: body.username,
        password: body.password,
        device: body.device ?? null,
        ipAddress: request.ip,
        userAgent: request.headers["user-agent"] || null,
        requestId: request.id
      });

      if (!result.ok) {
        if (result.retryAfterSeconds) {
          reply.header("Retry-After", String(result.retryAfterSeconds));
        }
        return sendError(reply, result.status, result.code, result.message);
      }
      return reply.code(result.status).send(result.payload);
    }
  );

  // Recover account password using 44-char hex recovery key (revokes all sessions + closes live WS).
  app.post(
    "/api/v1/account/recover",
    { config: { rateLimit: { max: 5, timeWindow: "1 minute" } } },
    async (request, reply) => {
      const body = request.body || {};
      const result = await authService.recover({
        masterPassphrase: body.masterPassphrase,
        newPassword: body.newPassword,
        rotateRecoveryKey: Boolean(body.rotateRecoveryKey),
        device: body.device ?? null,
        ipAddress: request.ip,
        userAgent: request.headers["user-agent"] || null,
        requestId: request.id
      });

      if (!result.ok) {
        if (result.retryAfterSeconds) {
          reply.header("Retry-After", String(result.retryAfterSeconds));
        }
        return sendError(reply, result.status, result.code, result.message);
      }
      return reply.code(result.status).send(result.payload);
    }
  );

  // Change password for authenticated account (revokes all other sessions & closes their WebSockets).
  app.post(
    "/api/v1/account/password",
    {
      preHandler: authenticate,
      config: { rateLimit: { max: 5, timeWindow: "1 minute" } }
    },
    async (request, reply) => {
      const body = request.body || {};
      const result = await authService.changePassword({
        accountId: request.account.id,
        currentSessionId: request.sessionId,
        currentPassword: body.currentPassword,
        newPassword: body.newPassword,
        ipAddress: request.ip,
        requestId: request.id
      });

      if (!result.ok) {
        return sendError(reply, result.status, result.code, result.message);
      }
      return sendSuccess(reply, result.payload);
    }
  );

  // Deliberately rotate the recovery key (requires current password).
  app.post(
    "/api/v1/account/recovery-key/rotate",
    {
      preHandler: authenticate,
      config: { rateLimit: { max: 3, timeWindow: "1 minute" } }
    },
    async (request, reply) => {
      const body = request.body || {};
      const result = await authService.rotateRecoveryKey({
        accountId: request.account.id,
        currentPassword: body.currentPassword,
        ipAddress: request.ip,
        requestId: request.id
      });

      if (!result.ok) {
        return sendError(reply, result.status, result.code, result.message);
      }
      return sendSuccess(reply, result.payload);
    }
  );

  // Return authenticated account/Node/device/session identity.
  app.get("/api/v1/me", { preHandler: authenticate }, async (request, reply) => {
    const node = nodeService.getNodeById(request.account.id);
    return sendSuccess(reply, {
      account: {
        id: request.account.id,
        username: request.account.username,
        displayName: node?.displayName || request.account.username
      },
      node,
      device: request.device,
      session: {
        id: request.sessionId,
        expiresAt: request.sessionExpiresAt
      }
    });
  });

  // Update own display name / profile.
  app.patch("/api/v1/me", { preHandler: authenticate }, async (request, reply) => {
    const body = request.body || {};
    if (!isValidDisplayName(body.displayName)) {
      return sendError(
        reply,
        400,
        "validation_error",
        "Display name must be between 1 and 64 characters."
      );
    }
    const updated = nodeService.updateProfile(request.account.id, {
      displayName: body.displayName
    });
    return sendSuccess(reply, {
      account: {
        id: updated.id,
        username: updated.username,
        displayName: updated.displayName
      },
      node: updated
    });
  });

  // Peer directory search for starting conversations/groups (active Nodes only, safe public fields).
  app.get("/api/v1/nodes/directory", { preHandler: authenticate }, async (request, reply) => {
    const q = request.query?.q || "";
    const limit = request.query?.limit || 30;
    const nodes = nodeService.searchDirectory({ query: q, limit });
    return sendSuccess(reply, { nodes });
  });
}
