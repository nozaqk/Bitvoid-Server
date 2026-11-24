import { randomBytes } from "node:crypto";
import { WebSocketServer, WebSocket } from "ws";

const TICKET_TTL_MS = 60_000;
const ALLOWED_EVENTS = new Set(["call-offer", "call-answer", "ice-candidate", "call-end", "call-reject"]);
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function attachCallSignaling(app, { pool, requireAccount }) {
  const tickets = new Map();
  const peers = new Map();
  const wss = new WebSocketServer({ noServer: true, maxPayload: 64 * 1024 });

  app.post("/api/v1/calls/ticket", { preHandler: requireAccount }, async req => {
    const ticket = randomBytes(32).toString("base64url");
    tickets.set(ticket, { accountId: req.account.id, expiresAt: Date.now() + TICKET_TTL_MS });
    return { ticket, expiresIn: Math.floor(TICKET_TTL_MS / 1000), path: "/api/v1/calls" };
  });

  const sweep = setInterval(() => {
    const now = Date.now();
    for (const [ticket, value] of tickets) if (value.expiresAt <= now) tickets.delete(ticket);
  }, 30_000);
  sweep.unref();

  app.server.on("upgrade", (request, socket, head) => {
    const url = new URL(request.url || "/", "http://localhost");
    if (url.pathname !== "/api/v1/calls") return;
    const ticket = url.searchParams.get("ticket") || "";
    const session = tickets.get(ticket);
    tickets.delete(ticket);
    if (!session || session.expiresAt <= Date.now()) {
      socket.write("HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n");
      socket.destroy();
      return;
    }

    pool.query("SELECT id,username,status FROM accounts WHERE id=$1", [session.accountId])
      .then(result => {
        const account = result.rows[0];
        if (!account || account.status !== "active") {
          socket.write("HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n");
          socket.destroy();
          return;
        }
        wss.handleUpgrade(request, socket, head, ws => {
          ws.account = { id: account.id, username: account.username };
          const connections = peers.get(account.id) || new Set();
          connections.add(ws);
          peers.set(account.id, connections);
          ws.send(JSON.stringify({ type: "connected", userId: account.id }));

          ws.on("message", async raw => {
            let message;
            try { message = JSON.parse(raw.toString()); } catch { return; }
            if (!message || !ALLOWED_EVENTS.has(message.type)) return;
            const to = String(message.to || "");
            const conversationId = String(message.conversationId || "");
            if (!UUID_RE.test(to) || !UUID_RE.test(conversationId) || to === account.id) return;
            if (!message.payload || typeof message.payload !== "object" || Array.isArray(message.payload)) return;
            if (JSON.stringify(message.payload).length > 32 * 1024) return;

            try {
              const membership = await pool.query(
                "SELECT account_id FROM conversation_members WHERE conversation_id=$1 AND account_id=ANY($2::uuid[])",
                [conversationId, [account.id, to]]
              );
              if (membership.rowCount !== 2) {
                ws.send(JSON.stringify({ type: "error", code: "call_not_authorized", message: "Both participants must belong to this conversation." }));
                return;
              }
              const recipients = peers.get(to);
              if (!recipients?.size) {
                ws.send(JSON.stringify({ type: "peer-unavailable", to, conversationId, callId: String(message.callId || "").slice(0, 100) }));
                return;
              }
              const relay = JSON.stringify({
                type: message.type,
                from: account.id,
                fromUsername: account.username,
                to,
                conversationId,
                callId: String(message.callId || "").slice(0, 100),
                payload: message.payload,
                sentAt: Date.now()
              });
              for (const peer of recipients) if (peer.readyState === WebSocket.OPEN) peer.send(relay);
            } catch (error) {
              app.log.error({ err: error }, "Call signaling relay failed");
              if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: "error", code: "signaling_failed" }));
            }
          });

          ws.on("close", () => {
            const connections = peers.get(account.id);
            connections?.delete(ws);
            if (!connections?.size) peers.delete(account.id);
          });
        });
      })
      .catch(error => {
        app.log.error({ err: error }, "Call signaling authentication failed");
        socket.destroy();
      });
  });

  app.addHook("onClose", async () => {
    clearInterval(sweep);
    for (const connections of peers.values()) for (const peer of connections) peer.close(1001, "Server shutting down");
    await new Promise(resolve => wss.close(() => resolve()));
  });

  return wss;
}
