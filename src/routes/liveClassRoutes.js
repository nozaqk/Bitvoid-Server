import { sendError, sendSuccess } from "./errorEnvelope.js";

export function registerLiveClassRoutes(app, ctx) {
  const { liveClassService, authenticate } = ctx;

  app.post("/api/v1/live-classes", { preHandler: authenticate }, async (request, reply) => {
    const body = request.body || {};
    const liveClass = liveClassService.createClass({
      hostAccountId: request.account.id,
      title: body.title,
      description: body.description ?? "",
      channelId: body.channelId ?? null,
      startImmediately: Boolean(body.startImmediately)
    });
    return sendSuccess(reply, { liveClass }, 201);
  });

  app.get("/api/v1/live-classes", { preHandler: authenticate }, async (request, reply) => {
    const liveClasses = liveClassService.listClasses({
      status: request.query?.status ?? null,
      limit: request.query?.limit
    });
    return sendSuccess(reply, { liveClasses });
  });

  app.get("/api/v1/live-classes/:classId", { preHandler: authenticate }, async (request, reply) => {
    const liveClass = liveClassService.getClass(request.params.classId);
    if (!liveClass) {
      return sendError(reply, 404, "class_not_found", "Live Class not found.");
    }
    return sendSuccess(reply, { liveClass });
  });

  app.post("/api/v1/live-classes/:classId/start", { preHandler: authenticate }, async (request, reply) => {
    const liveClass = liveClassService.startClass({
      classId: request.params.classId,
      actorId: request.account.id
    });
    return sendSuccess(reply, { liveClass });
  });

  app.post("/api/v1/live-classes/:classId/end", { preHandler: authenticate }, async (request, reply) => {
    const liveClass = liveClassService.endClass({
      classId: request.params.classId,
      actorId: request.account.id
    });
    return sendSuccess(reply, { liveClass });
  });

  app.post("/api/v1/live-classes/:classId/join", { preHandler: authenticate }, async (request, reply) => {
    const liveClass = liveClassService.joinClass({
      classId: request.params.classId,
      accountId: request.account.id
    });
    return sendSuccess(reply, { liveClass });
  });

  app.post("/api/v1/live-classes/:classId/leave", { preHandler: authenticate }, async (request, reply) => {
    const result = liveClassService.leaveClass({
      classId: request.params.classId,
      accountId: request.account.id
    });
    return sendSuccess(reply, result);
  });

  app.post("/api/v1/live-classes/:classId/signals", { preHandler: authenticate }, async (request, reply) => {
    const body = request.body || {};
    const signal = liveClassService.relaySignal({
      classId: request.params.classId,
      fromAccountId: request.account.id,
      fromDeviceId: request.device?.id || null,
      toAccountId: body.toNodeId || body.toAccountId || null,
      signalType: body.signalType,
      payload: body.payload ?? {}
    });
    return sendSuccess(reply, { signal }, 201);
  });

  app.get("/api/v1/live-classes/:classId/signals", { preHandler: authenticate }, async (request, reply) => {
    const signals = liveClassService.listSignals({
      classId: request.params.classId,
      accountId: request.account.id,
      afterSeq: request.query?.afterSeq ?? 0,
      limit: request.query?.limit
    });
    return sendSuccess(reply, { signals });
  });
}
