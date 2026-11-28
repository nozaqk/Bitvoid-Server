# AirMesh Server API v1 — Authoritative Contract

**Version:** `1.1.0`  
**Status:** Implemented and verified by automated unit, contract, integration, and security tests in `nozaqk/Bitvoid-Server`.

This specification is the single authoritative API contract for AirMesh Server (self-hosted and centrally hosted deployments) and the native AirMesh Android client (`nozaqk/BitVoid`).

> **Architecture boundary:** This HTTP/WebSocket API serves end-user Node clients (Android). Server-wide administration is **NOT** exposed over HTTP/WebSocket; all Server administration runs exclusively through the protected local IPC channel (Unix domain socket `0600` / Windows named pipe) used by the native Qt 6 Desktop Dashboard and `bitvoid-admin` CLI.

---

## 1. Transport, Discovery, and Identity

- **Default port:** TCP `8787`, default bind `0.0.0.0`.
- **Local HTTP / WS:** `http://HOST:8787`, `ws://HOST:8787/api/v1/events` (trusted private LAN only).
- **TLS (HTTPS / WSS):** Enabled via `BITVOID_TLS_CERT` and `BITVOID_TLS_KEY`. Required for untrusted networks, multi-site VPNs, and centrally hosted deployments.
- **mDNS / DNS-SD (link-local only):** Advertises `_bitvoid-server._tcp` (canonical) and `_http._tcp` (compatibility) with TXT fields `serverId`, `api=v1`, `version`, `tls`, `mode`, `name`. Automatically disabled in `vpn` mode.
- **Identity verification:** Discovery is advisory. Clients must verify `GET /api/v1/server/info` (or `GET /api/v1/server/trust-bundle`) and pin `serverId` (and `tls.fingerprint256` when TLS is enabled).

---

## 2. HTTP Conventions & Envelopes

- JSON UTF-8 request/response bodies.
- Authenticated routes require header: `Authorization: Bearer <access-token>`.
- **Never** send bearer tokens in query strings or URLs (strictly rejected on both HTTP and WebSocket).
- Every registered account is a **Node** (`usr_...`). One Node can own multiple **Devices** (`dev_...`) and multiple **Sessions**.
- Standard success envelope (for `/api/v1/server/info`, `/me`, devices, sessions, messaging, channels, live classes, attachments, sync):
  ```json
  {
    "data": { ... },
    "meta": { "requestId": "req-1", "serverTime": "2026-11-27T18:00:00.000Z" }
  }
  ```
- Backward-compatible top-level payloads preserved for Android `BitVoidAccountAuth`:
  - `GET /api/v1/health`: `{ ok, status, apiVersion, serverVersion, serverId, uptimeSeconds }`
  - `POST /api/v1/account/register`: `{ account, node, device, token, refreshToken, expiresAt, refreshExpiresAt, masterPassphrase }`
  - `POST /api/v1/account/login`: `{ account, node, device, token, refreshToken, expiresAt, refreshExpiresAt }`
  - `POST /api/v1/account/recover`: `{ account, node, device, token, refreshToken, expiresAt, refreshExpiresAt, masterPassphrase? }`
- Standard error envelope:
  ```json
  {
    "error": { "code": "validation_error", "message": "Human-readable explanation" },
    "meta": { "requestId": "req-1", "serverTime": "2026-11-27T18:00:00.000Z" }
  }
  ```

---

## 3. Implemented & Tested Endpoints

### 3.1 System & Discovery

| Method | Path | Auth | Purpose |
|---|---|---|---|
| `GET` | `/api/v1/health` | No | Liveness/readiness, version, `serverId`, uptime |
| `GET` | `/api/v1/server/info` | No | Stable `serverId`, capabilities, transport, TLS SHA-256 fingerprint, discovery metadata |
| `GET` | `/api/v1/server/trust-bundle` | No | Public read-only Server identity bootstrap profile & LAN/VPN endpoints for Android pinning |

### 3.2 Accounts (Nodes), Authentication, Devices & Sessions

| Method | Path | Auth | Purpose |
|---|---|---|---|
| `POST` | `/api/v1/account/register` | No | Create Node (Argon2id password hash), enroll initial device, issue access + refresh tokens and one-time 44-char hex `masterPassphrase` |
| `POST` | `/api/v1/account/login` | No | Authenticate Node (verifies Argon2id or transparently upgrades legacy bcrypt -> Argon2id), enroll/touch device, issue access + refresh tokens |
| `POST` | `/api/v1/account/recover` | No | Reset password via 44-char hex recovery key, revoke ALL sessions & disconnect live WebSockets, optionally rotate recovery key (`rotateRecoveryKey: true`) |
| `POST` | `/api/v1/account/password` | Bearer | Change password (requires `currentPassword`), revokes all other sessions & closes their WebSockets |
| `POST` | `/api/v1/account/recovery-key/rotate` | Bearer | Rotate recovery key (requires `currentPassword`), returns fresh one-time `masterPassphrase` |
| `GET` | `/api/v1/me` | Bearer | Return authenticated `account`, `node`, `device`, and `session` |
| `PATCH` | `/api/v1/me` | Bearer | Update own `displayName` |
| `GET` | `/api/v1/nodes/directory` | Bearer | Search active Nodes (`?q=...&limit=...`) to start conversations |
| `POST` | `/api/v1/auth/refresh` | No | Rotate `refreshToken` into fresh access + refresh pair (with replay/reuse detection!) |
| `POST` | `/api/v1/auth/revoke` | Bearer | Revoke current session & terminate its WebSocket connections |
| `POST` | `/api/v1/auth/revoke-others` | Bearer | Revoke all other sessions for the current Node |
| `GET` | `/api/v1/sessions` | Bearer | List sessions for the authenticated Node |
| `DELETE` | `/api/v1/sessions/:sessionId` | Bearer | Revoke a specific session belonging to the authenticated Node |
| `POST` | `/api/v1/devices` | Bearer | Enroll or refresh a device record for the authenticated Node |
| `GET` | `/api/v1/devices` | Bearer | List devices owned by the authenticated Node |
| `PATCH` | `/api/v1/devices/:deviceId` | Bearer | Update device display name or trust state |
| `DELETE` | `/api/v1/devices/:deviceId` | Bearer | Revoke device, revoke all of its sessions, and disconnect its WebSockets |

### 3.3 Direct & Group Conversations and Messages

| Method | Path | Auth | Purpose |
|---|---|---|---|
| `POST` | `/api/v1/conversations` | Bearer | Create direct (`type: "direct", peerNodeId`) or group (`type: "group", title, memberIds`) conversation |
| `GET` | `/api/v1/conversations` | Bearer | List conversations where the authenticated Node is a member |
| `GET` | `/api/v1/conversations/:conversationId` | Bearer | Get conversation details, members, and last message (members only) |
| `POST` | `/api/v1/conversations/:conversationId/members` | Bearer | Add Node to group conversation (owner/admin only) |
| `DELETE` | `/api/v1/conversations/:conversationId/members/:nodeId` | Bearer | Remove Node from group (or leave) |
| `POST` | `/api/v1/conversations/:conversationId/messages` | Bearer | Send message (idempotent via `clientMessageId` or `Idempotency-Key` header) |
| `GET` | `/api/v1/conversations/:conversationId/messages` | Bearer | Cursor-paginated message history (`?beforeSeq=`, `?afterSeq=`, `?limit=`) |
| `PATCH` | `/api/v1/conversations/:conversationId/messages/:messageId` | Bearer | Edit own message |
| `DELETE` | `/api/v1/conversations/:conversationId/messages/:messageId` | Bearer | Soft-delete message (creates tombstone and fans out delete event) |
| `POST` | `/api/v1/conversations/:conversationId/messages/:messageId/receipts` | Bearer | Record `delivered` or `read` receipt |

### 3.4 Channels

| Method | Path | Auth | Purpose |
|---|---|---|---|
| `POST` | `/api/v1/channels` | Bearer | Create public or private channel |
| `GET` | `/api/v1/channels` | Bearer | List public channels and joined private channels |
| `POST` | `/api/v1/channels/:channelId/join` | Bearer | Join public channel |
| `POST` | `/api/v1/channels/:channelId/members` | Bearer | Invite/assign role (`member`/`moderator`) in channel (owner/moderator only) |
| `POST` | `/api/v1/channels/:channelId/leave` | Bearer | Leave channel |
| `POST` | `/api/v1/channels/:channelId/messages` | Bearer | Post channel message (idempotent via `clientMessageId`) |
| `GET` | `/api/v1/channels/:channelId/messages` | Bearer | List channel messages (`?afterSeq=`, `?limit=`) |
| `DELETE` | `/api/v1/channels/:channelId/messages/:messageId` | Bearer | Soft-delete channel message (sender, moderator, or owner) |

### 3.5 Live Classes & WebRTC Signaling

| Method | Path | Auth | Purpose |
|---|---|---|---|
| `POST` | `/api/v1/live-classes` | Bearer | Create Live Class (`scheduled` or `startImmediately: true`) |
| `GET` | `/api/v1/live-classes` | Bearer | List Live Classes (`?status=scheduled|live|ended`) |
| `GET` | `/api/v1/live-classes/:classId` | Bearer | Get Live Class metadata & active participants |
| `POST` | `/api/v1/live-classes/:classId/start` | Bearer | Start Live Class (host only) |
| `POST` | `/api/v1/live-classes/:classId/end` | Bearer | End Live Class (host only) |
| `POST` | `/api/v1/live-classes/:classId/join` | Bearer | Join Live Class |
| `POST` | `/api/v1/live-classes/:classId/leave` | Bearer | Leave Live Class |
| `POST` | `/api/v1/live-classes/:classId/signals` | Bearer | Relay WebRTC signal (`offer`, `answer`, `ice-candidate`, `mute`, `unmute`, `raise-hand`, `leave`) over realtime WS + short retention log |
| `GET` | `/api/v1/live-classes/:classId/signals` | Bearer | Catch up non-expired signaling events (`?afterSeq=`) |

### 3.6 File Attachments

| Method | Path | Auth | Purpose |
|---|---|---|---|
| `POST` | `/api/v1/attachments` | Bearer | Streaming multipart upload (`?scopeType=conversation|channel|live-class|personal&scopeId=...`); enforces max upload size & per-Node quota |
| `GET` | `/api/v1/attachments/:attachmentId` | Bearer | Get attachment metadata (authorized members/uploader only) |
| `GET` | `/api/v1/attachments/:attachmentId/download` | Bearer | Download file stream with `X-Content-Type-Options: nosniff` & `Content-Disposition: attachment` |
| `DELETE` | `/api/v1/attachments/:attachmentId` | Bearer | Delete attachment (uploader only) |

### 3.7 Durable Offline & Multi-Device Synchronization

| Method | Path | Auth | Purpose |
|---|---|---|---|
| `GET` | `/api/v1/sync/events` | Bearer | Pull ordered durable events (`?afterSeq=`, defaults to saved device cursor) |
| `POST` | `/api/v1/sync/cursor` | Bearer | Acknowledge per-device `lastSeq` cursor |
| `POST` | `/api/v1/sync/outbox` | Bearer | Flush queued offline operations (`conversation.message`, `channel.message`, `message.receipt`) with idempotent deduplication |

### 3.8 Realtime WebSocket (`WS /api/v1/events`)

- Authenticate exclusively via HTTP `Authorization: Bearer <access-token>` header during handshake.
- On connect, Server sends `{ eventId, type: "connected", serverId, nodeId, sessionId, deviceId, occurredAt }`.
- Client frames supported:
  - `{ "type": "ping", "id": "..." }` -> `{ "type": "pong", "id": "..." }`
  - `{ "type": "subscribe", "topic": "conversation:<id>|channel:<id>|live-class:<id>" }` (strict membership check; emits `subscribed` or `subscription_error`)
  - `{ "type": "unsubscribe", "topic": "..." }`
  - `{ "type": "typing", "conversationId": "...", "isTyping": true|false }`
- Server-pushed realtime events include unique `eventId`, monotonic `seq` (for durable events), `type`, `entityType`, `entityId`, `payload`, `occurredAt`.
- Revoking a session (`4001`), expiring a session (`4002`), revoking a device (`4003`), or suspending a Node (`4004`) terminates active sockets immediately.

---

## 4. Android Client Migration Notes (`nozaqk/BitVoid`)

When updating the Android client repository against this Server contract:

> Full Phase 3 conformance plan, component migration map, error behaviour, and exit criteria: [`docs/ANDROID-INTEGRATION.md`](./ANDROID-INTEGRATION.md).

1. Keep `BitVoidAccountAuth` calling `/api/v1/account/register`, `/login`, `/recover` and persist `refreshToken` + `device.id` in Keystore-backed storage alongside the access `token`.
2. Replace legacy `/api/v1/pairing/request` and `/api/v1/users/register` calls in `BitVoidLocalApi` with the unified account/device session token and `/api/v1/devices`, `/api/v1/conversations`, `/api/v1/channels`, `/api/v1/live-classes`, `/api/v1/attachments`, and `/api/v1/sync/*`.
3. Parse `/api/v1/me` from `data.account`, `data.node`, `data.device`, and `data.session`.
4. Standardize mDNS discovery on `_bitvoid-server._tcp` (with `_http._tcp` fallback) and verify `serverId` + `tls.fingerprint256` from `/api/v1/server/trust-bundle` for trusted LAN/Hotspot/VPN Server profiles.
5. Migrate local cached messages & outbox items to `/api/v1/sync/outbox` before retiring the legacy embedded `BitVoidLocalServer`.
