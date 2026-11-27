import { WS_CLOSE_CODES } from "../config/constants.js";
import { nowIso } from "../security/crypto.js";
import { extractBearerToken } from "./authMiddleware.js";

export function registerWsRoutes(app, ctx) {
  const { serverId, sessionService, eventHub, authorizeTopicSubscription } = ctx;

  app.get("/api/v1/events", { websocket: true }, (socket, request) => {
    // Tokens must NEVER be accepted via query strings — Authorization header only.
    const token = extractBearerToken(request.headers.authorization);
    if (!token) {
      socket.close(WS_CLOSE_CODES.POLICY_VIOLATION, "Unauthorized");
      return;
    }

    const auth = sessionService.verifyAccessToken(token, { touch: true });
    if (!auth.ok) {
      const code =
        auth.code === "session_expired"
          ? WS_CLOSE_CODES.SESSION_EXPIRED
          : auth.code === "device_revoked"
            ? WS_CLOSE_CODES.DEVICE_REVOKED
            : auth.code === "account_suspended"
              ? WS_CLOSE_CODES.NODE_SUSPENDED
              : WS_CLOSE_CODES.POLICY_VIOLATION;
      socket.close(code, auth.message);
      return;
    }

    const conn = eventHub.register({
      socket,
      accountId: auth.account.id,
      username: auth.account.username,
      sessionId: auth.sessionId,
      deviceId: auth.device?.id || null,
      expiresAt: auth.expiresAt
    });

    eventHub.sendToConnection(conn.id, {
      type: "connected",
      serverId,
      nodeId: auth.account.id,
      sessionId: auth.sessionId,
      deviceId: auth.device?.id || null,
      occurredAt: nowIso()
    });

    socket.on("message", (raw) => {
      const buf = Buffer.isBuffer(raw) ? raw : Buffer.from(String(raw), "utf8");
      eventHub.recordInboundBytes(conn.id, buf.length);

      // Re-check expiration on activity.
      if (conn.expiresAtMs <= Date.now()) {
        eventHub.disconnectSession(
          conn.sessionId,
          WS_CLOSE_CODES.SESSION_EXPIRED,
          "Session expired"
        );
        return;
      }

      let message;
      try {
        message = JSON.parse(buf.toString("utf8"));
      } catch {
        socket.close(WS_CLOSE_CODES.INVALID_DATA, "Invalid JSON");
        return;
      }

      if (!message || typeof message !== "object") return;

      if (message.type === "ping" && typeof message.id === "string") {
        eventHub.sendToConnection(conn.id, {
          type: "pong",
          id: message.id,
          occurredAt: nowIso()
        });
        return;
      }

      if (message.type === "subscribe" && typeof message.topic === "string") {
        const topic = message.topic.trim();
        const allowed = authorizeTopicSubscription
          ? authorizeTopicSubscription({ accountId: conn.accountId, topic })
          : false;
        if (!allowed) {
          eventHub.sendToConnection(conn.id, {
            type: "subscription_error",
            topic,
            code: "forbidden",
            message: "Not authorized to subscribe to this topic."
          });
          return;
        }
        eventHub.subscribe(conn.id, topic);
        eventHub.sendToConnection(conn.id, {
          type: "subscribed",
          topic
        });
        return;
      }

      if (message.type === "unsubscribe" && typeof message.topic === "string") {
        const topic = message.topic.trim();
        eventHub.unsubscribe(conn.id, topic);
        eventHub.sendToConnection(conn.id, {
          type: "unsubscribed",
          topic
        });
        return;
      }

      if (message.type === "typing" && typeof message.conversationId === "string") {
        const topic = `conversation:${message.conversationId}`;
        if (conn.topics.has(topic)) {
          eventHub.sendToTopic(
            topic,
            {
              type: "typing",
              conversationId: message.conversationId,
              nodeId: conn.accountId,
              username: conn.username,
              isTyping: Boolean(message.isTyping)
            },
            { excludeConnectionId: conn.id }
          );
        }
      }
    });
  });
}
