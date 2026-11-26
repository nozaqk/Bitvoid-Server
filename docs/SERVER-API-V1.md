# BitVoid Server API v1 contract

This document is the shared implementation contract for the native Android app and the headless application Server.

## Architecture boundary

- Android is the only user-facing client.
- The Gateway provides local Wi-Fi, health, and discovery only.
- The application Server is a separate device/service and owns pairing, authentication, application data, persistence, synchronization, and real-time events.
- The app connects directly to the Server over the same local Wi-Fi. It must not send application requests through the Gateway.
- Cloud services are optional; local communication must work without internet access.

## Network defaults and discovery

- Server TCP port: `8787`.
- HTTP: `http://<server-ip>:8787`.
- WebSocket: `ws://<server-ip>:8787/api/v1/events`.
- DNS-SD: `_bitvoid-server._tcp.local.`.
- Preferred hostname: `bitvoid-server.local`.
- Bind local sockets to the Android Wi-Fi Network selected for BitVoid.
- The Gateway IP (currently `192.168.4.1`) is not the Server IP.
- Discovery is advisory. Verify `GET /api/v1/server/info` and the stable `serverId` before trusting an endpoint.

## HTTP conventions

- All routes are versioned under `/api/v1`.
- JSON uses UTF-8 and `application/json`.
- Authenticated routes require `Authorization: Bearer <device-token>`.
- The Gateway's private trust secret is never an app-user credential.
- Mutating requests accept `Idempotency-Key`; messages also carry a client-generated `clientMessageId`.
- Timestamps are ISO-8601 UTC. IDs are opaque Server-generated strings. Pagination uses opaque cursors.

Success envelope:
```json
{ "data": {}, "meta": { "requestId": "req_id", "serverTime": "2026-11-26T17:00:00Z" } }
```

Error envelope:
```json
{ "error": { "code": "validation_error", "message": "Explanation", "details": {} }, "meta": { "requestId": "req_id" } }
```

Use HTTP status codes consistently: 400 validation, 401 unauthenticated, 403 forbidden, 404 missing, 409 conflict, 413 too large, 429 rate limit, and 5xx server failure.

## REST endpoint inventory

### Health and identity

| Method | Path | Auth | Purpose |
|---|---|---|---|
| GET | `/api/v1/health` | No | Liveness/readiness and API version |
| GET | `/api/v1/server/info` | No | Stable Server identity, versions, capabilities and links |

Server info includes `serverId`, `displayName`, `apiVersion`, `eventProtocolVersion`, `capabilities`, and `links`.

### Pairing and authentication

| Method | Path | Auth | Purpose |
|---|---|---|---|
| POST | `/api/v1/pairing/requests` | No | Create short-lived pairing request for this app installation |
| GET | `/api/v1/pairing/requests/{requestId}` | Pairing secret | Poll pairing state |
| POST | `/api/v1/pairing/requests/{requestId}/approve` | Admin | Approve/reject using an authorized admin client |
| POST | `/api/v1/auth/token` | Pairing proof | Exchange approved proof for device token |
| POST | `/api/v1/auth/revoke` | Device | Revoke current device token |
| GET | `/api/v1/me` | Device | Return account and device identity |

Pairing must expire, be rate-limited, and bind to a device installation. Tokens must be revocable and stored securely on Android. Never place long-lived tokens in WebSocket query strings.

### Conversations and messages

| Method | Path | Auth | Purpose |
|---|---|---|---|
| GET/POST | `/api/v1/conversations` | Device | List/create direct or group conversations |
| GET | `/api/v1/conversations/{id}/messages` | Device | Read history with cursor pagination |
| POST | `/api/v1/conversations/{id}/messages` | Device | Send message |
| POST | `/api/v1/messages/{id}/receipts` | Device | Update delivered/read receipt |

A message includes `clientMessageId`, message type, content or attachment metadata, and optional reply reference. The Server assigns `messageId`, validates membership, persists the message, acknowledges it, then broadcasts `message.created`. Repeated submissions with the same idempotency key/client ID must not create duplicates.

### Channels and Live Classes

| Method | Path | Auth | Purpose |
|---|---|---|---|
| GET/POST | `/api/v1/channels` | Device | List/create channels |
| GET/PATCH/DELETE | `/api/v1/channels/{id}` | Device | Read/update/delete where permitted |
| GET | `/api/v1/channels/{id}/messages` | Device | Read channel history |
| POST | `/api/v1/channels/{id}/messages` | Device | Publish channel message |
| GET/POST | `/api/v1/live-classes` | Device | List/create Live Classes |
| GET | `/api/v1/live-classes/{id}` | Device | Read class details |
| POST | `/api/v1/live-classes/{id}/join` | Device | Join class |
| POST | `/api/v1/live-classes/{id}/leave` | Device | Leave class |

REST controls class metadata, membership, and signaling. Real-time audio requires a separately negotiated media transport; JSON WebSocket events do not carry the audio stream themselves.

### Offline synchronization

| Method | Path | Auth | Purpose |
|---|---|---|---|
| GET | `/api/v1/sync?cursor={cursor}` | Device | Return ordered changes after opaque cursor |

The response contains ordered changes, a new cursor, and server time. Android maintains an encrypted local outbox and retries with the same idempotency key/client ID. Remove an outbox item only after durable acknowledgement. Advance the sync cursor only after changes are persisted locally.

## WebSocket event protocol

Connect to `/api/v1/events` with the device bearer token in the HTTP Authorization header. Authenticate the handshake and authorize every subscription.

Client subscription:
```json
{ "type": "subscribe", "conversationIds": ["conv_1"], "channelIds": ["channel_1"], "liveClassIds": ["class_1"] }
```

Client heartbeat:
```json
{ "type": "ping", "id": "ping_1" }
```

Server event:
```json
{
  "eventId": "evt_id",
  "type": "message.created",
  "occurredAt": "2026-11-26T17:00:00Z",
  "data": {
    "messageId": "msg_id",
    "conversationId": "conv_id",
    "senderId": "user_or_device_id",
    "clientMessageId": "client_id",
    "content": { "type": "text", "text": "Hello" }
  }
}
```

Initial event types: `message.created`, `message.updated`, `message.deleted`, `receipt.updated`, `typing.started`, `typing.stopped`, `presence.changed`, `channel.created`, `channel.updated`, `live_class.started`, `live_class.ended`, `live_class.participant_joined`, `live_class.participant_left`, and `sync.available`.

Events provide immediate UI updates but are not the durable source of truth. After reconnect, the app calls sync using its last durable cursor to recover missed changes. The Server sends heartbeats and closes expired/revoked sessions.

## Security requirements

- Authenticate app devices with revocable device tokens.
- Enforce conversation/channel/class membership on every operation and subscription.
- Validate and size-limit all payloads and attachments.
- Rate-limit unauthenticated pairing and sensitive operations.
- Keep Gateway-to-Server trust credentials separate from app-device tokens.
- Do not expose local services directly to the public internet.
- Use TLS for deployments that cross an untrusted network; local isolated Wi-Fi HTTP is the initial hardware-test transport and does not provide encryption.

## Implementation order

1. Finish physical Gateway Wi-Fi, endpoint, station-count, and stability tests.
2. Implement the headless Server against this contract (Fastify, persistent storage, REST, WebSocket).
3. Add Server discovery and connect the Android Server client to the resolved Server address.
4. Integrate pairing, messaging, channels, Live Classes, and offline sync.
5. Run end-to-end tests with the Gateway and Server on the same local Wi-Fi.

No GitHub Actions are required.
