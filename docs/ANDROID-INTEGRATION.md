# AirMesh Android Client Integration — Phase 3 Companion Document

| | |
|---|---|
| **Document version** | 1.0.0 |
| **Date** | 2026-11-27 |
| **Companion to** | [`docs/PHASE-1-ARCHITECTURE-AUDIT.md`](./PHASE-1-ARCHITECTURE-AUDIT.md) |
| **Contract of record** | [`docs/SERVER-API-V1.md`](./SERVER-API-V1.md) — API v1, version `1.1.0` |
| **Server commit of record** | `9988e41` (`main`), Server/API `1.1.0` |
| **Android commit of record** | `7f2aa122166991bef1d4ae69be4456cb9abc0ced` (`nozaqk/BitVoid`, `main`) — as audited in Phase 1 |

**Status: planning and handoff only.** This document specifies how the native Android client (`nozaqk/BitVoid`) must be migrated onto the Server API v1 contract. It performs no Android work and claims no Android feature as complete. Phase 3 exit criteria (Section 12) are all currently **unmet**.

---

## 1. Purpose and scope

Phase 1's exit criterion requires "this document **and** the Android integration companion document ... committed on reviewable branches" ([`PHASE-1-ARCHITECTURE-AUDIT.md` §9](./PHASE-1-ARCHITECTURE-AUDIT.md#9-phased-implementation-roadmap)). This is that companion document.

It exists to give the Android migration a single, Server-verified target so Phase 3 does not re-derive the contract on the client side. It covers:

- The component-by-component migration map for the existing Android code.
- The exact wire shapes Android must produce and consume (Section 6).
- Client-side behaviour for every error and WebSocket close condition (Sections 6.6, 7).
- The offline/multi-device consistency model and how to migrate pending outbox data (Section 8).
- Discovery, trust, and TLS pinning requirements (Section 6.7).
- What the Server deliberately does **not** offer, so the client does not build UI for it (Section 10).
- The test plan and exit criteria that Phase 3 must satisfy (Sections 11, 12).

Out of scope: Server-side changes (Phase 2/4/5/6), desktop dashboard, packaging, release pipelines.

---

## 2. Provenance and verification limits

Every claim in this document is marked so that no one mistakes a plan for a verified fact.

| Marker | Meaning |
|---|---|
| **[V]** | Verified in `nozaqk/Bitvoid-Server` at commit `9988e41` by reading the implementing source or an executing test in this conversation. |
| **[A]** | Taken from the Phase 1 audit of `nozaqk/BitVoid` at `7f2aa12`. **Not re-verified** — it describes the Android repository as of that commit and may already be stale. |
| **[P]** | Proposed work. Implemented nowhere yet. |

**Important limitation.** The Android repository is private and was **not accessible** during the writing of this document (`GET /repos/nozaqk/BitVoid` → `403 Resource not accessible by integration`; anonymous access also `403`; `git ls-remote` → `403`). Therefore:

- No Android source file was read to produce this document.
- Every `[A]` row is a statement about the audited commit, not about the Android repository's current state.
- The Android-side "current state" columns and the exit-criteria checklist must be re-confirmed against the actual tree in a BitVoid-scoped session before any Phase 3 work is claimed complete.

The Server side, by contrast, is fully verifiable here and is the part this document is authoritative for.

**Server verification run** (2026-11-27, at `9988e41` plus this documentation change):

```
npm run check  → Syntax check passed for 73 JavaScript file(s).
npm test       → tests 28 | pass 28 | fail 0 | duration ~8.4s
```

This includes `test/contract/android-api-v1.test.js`, the Android-facing contract test. The suite was executed for this document, so every `[V]` marker below is backed by a passing test or by source read in the same session.

---

## 3. Contract invariants the client must adopt

These are the rules Android code most often violates. They are not optional interpretations; each is enforced by Server source or test **[V]**.

1. **One account is one Node.** `account.id` and `node.nodeId` are the same value and both start with `usr_`. There is no separate user/node identity to reconcile.
2. **Access tokens are bearer JWTs sent only in the `Authorization: Bearer` header.** The Server never reads a token from a query string: over HTTP such a request simply fails with `401 unauthenticated`, and the WebSocket handshake closes with `1008` policy violation **[V]**.
3. **Refresh tokens rotate on every refresh.** Replaying an already-used refresh token is treated as compromise (`refresh_token_reused`) and **revokes every active session for that device** — or every session of the account, if the token carries no device — closing their sockets **[V]**. The client must never fire two refreshes concurrently.
4. **Registration, login and recovery return flat top-level payloads**, not the `{data, meta}` envelope. Every other endpoint returns the envelope. Parsers must handle both, per endpoint **[V]**.
5. **`/me` is nested**: `data.account`, `data.node`, `data.device`, `data.session` **[V]**. There is no flat `username` at the top level.
6. **Every authenticated call is scoped to a device where one exists.** Sync cursors and outbox attribution require a device-bound session; without one the Server returns `device_required` **[V]**.
7. **Sends are idempotent by `clientMessageId`** (or the `Idempotency-Key` header). A duplicate send returns `200` with `deduplicated: true` instead of `201` **[V]**. The client must treat both as success.
8. **Realtime is an optimisation, not the source of truth.** Durable truth is `/api/v1/sync/events` with a monotonic `seq`. A client that only listens to the socket will silently lose events across reconnects **[V]**.
9. **Revocation is immediate.** Session revocation, device revocation and Node suspension close live sockets with application close codes `4001`–`4004`, and the client must not auto-reconnect on them — with one exception: `4001` sent because the client's *own* token refresh rotated the session is followed by an immediate reconnect using the new token (Section 6.3) **[V]**.
10. **Timestamps are ISO-8601 UTC strings** (`meta.serverTime`, `occurredAt`, `expiresAt`). Ordering must use `seq`, never wall-clock comparison.

---

## 4. Component migration map

Components named in the Phase 1 audit **[A]**. Targets and contract bindings are **[V]** against `SERVER-API-V1.md`.

| Android component (audited path) | Current state **[A]** | Required end state | Server contract binding |
|---|---|---|---|
| `network/auth/BitVoidAccountAuth.kt` | Already calls `/account/register`, `/login`, `/recover` | Keep as the only sign-in/sign-up path; add `/auth/refresh`, `/me`, `/auth/revoke`, `/devices`; persist `refreshToken` + `device.id` in Keystore-backed storage | §6.1, §6.2, §6.3 |
| `network/local/BitVoidLocalApi.kt` | Uses legacy `/api/v1/pairing/request` and `/api/v1/users/register`; also messaging calls | Delete legacy pairing/registration calls; re-point all messaging, channel, class, attachment, sync calls at the unified session token | §6.4, §6.5 |
| `network/local/BitVoidLocalCredentials.kt` | Stores local pairing credentials | Replace pairing-token storage with session/device credential storage; zeroise on revoke | §6.3 |
| `network/local/BitVoidLocalStore.kt` | Local cache + pending outbox | Keep as local cache; align outbox operations to the three Server-accepted types and add cursor persistence | §8 |
| `network/backend/BitVoidLocalDiscovery.kt` | Discovery with automatic retry | Standardise on `_bitvoid-server._tcp`, `_http._tcp` fallback; parse TXT; verify identity after connect | §6.7 |
| `network/backend/BitVoidBackendConnectionManager.kt` | Connection manager | Own the WS lifecycle, backoff, and the "do not reconnect" set of close codes | §6.6 |
| `network/local/BitVoidLocalViewModel.kt`, `network/ui/BitVoidViewModel.kt` | Local-first view models | Split state into Server-backed vs. local scratch; drive from sync cursor, not socket events alone | §8 |
| `network/server/BitVoidLocalServer.kt` | Embedded HTTP/WS server still present | Retire **last**, only after every dependent feature is served by the desktop Server | — |
| `network/service/BitVoidForegroundService.kt` | Foreground service for embedded server | Repurpose as the client's connection/keep-alive service; no listening sockets | — |
| `AndroidManifest.xml` | `android:usesCleartextTraffic="true"` | Restrict cleartext to a debug-only manifest overlay; production profiles require validated TLS | §6.7, §9 |

---

## 5. Phase 3 work-item conformance matrix

Items as written in the Phase 1 audit's "Phase 3 — Android client migration".

| # | Work item | Server side | Android side | Blocking questions |
|---|---|---|---|---|
| 1 | Username/password as the single sign-in/sign-up path | **Ready [V]** — register/login/recover implemented and contract-tested | **[P]** Legacy pairing path removal unverified | Does any shipped feature still require pairing? |
| 2 | Replace legacy pairing token with unified account/device session token | **Ready [V]** — `dev_...` devices, per-device sessions, `/devices` CRUD | **[P]** | Migration of existing paired installs with no server account |
| 3 | Align `/me`, discovery, envelope, event protocol, error handling | **Ready [V]** — see §6.2, §6.6, §7 | **[P]** | — |
| 4 | Explicit trusted Server profiles (LAN / hotspot / VPN / central) | **Ready [V]** — `/server/trust-bundle` returns `profile`, `lanEndpoints`, `vpnEndpoints` | **[P]** | Profile storage + re-trust UX on `serverId` change |
| 5 | mDNS discovery for same-link; manual/QR setup for routed | **Ready [V]** — `_bitvoid-server._tcp`, `_http._tcp`, TXT fields; mDNS disabled in `vpn` mode | **[P]** | QR payload format (not defined by Server) |
| 6 | Migrate cached messages and pending outbox without data loss | **Ready [V]** — `/sync/outbox` (1–100 ops), idempotent dedupe | **[P]** — highest-risk item | Local message IDs vs. Server `clientMessageId` mapping |
| 7 | Retire embedded Android Server only after dependents move | N/A (Server provides the endpoints) | **[P]** — must be last | Full dependent-feature inventory |
| 8 | Restrict cleartext to dev; validated TLS in production | **Ready [V]** — TLS via `BITVOID_TLS_CERT`/`BITVOID_TLS_KEY`, SHA-256 fingerprint in `/server/info` and trust bundle | **[P]** | Certificate bootstrap UX for first-run LAN |

No item is complete. Items 1–5 and 8 are unblocked today and gated only on Android work. Items 6 and 7 need a data-migration design before code.

---

## 6. Wire reference

Exact shapes the client must produce and consume. All `[V]`.

> Responses may contain **additional** fields beyond those shown; the client must ignore unknown fields rather than fail on them. The fields shown are the ones the client is entitled to depend on.

### 6.1 Register / login / recover (flat payloads, not enveloped)

`POST /api/v1/account/register` — `201`, rate limit `max(5, BITVOID_AUTH_RATE_LIMIT_MAX)`/min/IP (default `BITVOID_AUTH_RATE_LIMIT_MAX=8`, so 8/min by default; never below 5)

```json
{
  "username": "AndroidUser_01",
  "password": "AndroidStrongPassword123!",
  "displayName": "Ama",
  "device": {
    "displayName": "Pixel 8",
    "platform": "android",
    "appVersion": "2.0.0",
    "deviceFingerprint": "sha256-of-android-id",
    "publicKey": "optional-base64"
  }
}
```

- `displayName` and `device` are **optional** on register, login **and** recover **[V]**. Always send `device`: without it the Server records the device as `"platform": "unknown"` with a generic name, which the dashboard then shows. `device.deviceId` (or `device.id`) on **login** re-attaches the session to an already-enrolled device instead of creating a second one **[V]**.
- Newly enrolled devices are created with `trustStatus: "trusted"` **[V]**.
- A **revoked** device is deliberately never resurrected: the next enrol with its fingerprint produces a **new** `dev_...` id **[V]**. The client must handle its `device.id` changing and must not assume the old id is still valid.

```json
{
  "account": { "id": "usr_...", "username": "androiduser_01" },
  "node":    { "nodeId": "usr_...", "displayName": "..." },
  "device":  { "id": "dev_...", "platform": "android", "trustStatus": "trusted" },
  "token": "eyJ...",
  "refreshToken": "bvr_...",
  "expiresAt": "2026-11-27T19:00:00.000Z",
  "refreshExpiresAt": "2026-12-27T18:00:00.000Z",
  "masterPassphrase": "0f1e...44 hex chars..."
}
```

- `username` is normalised to lower case and compared case-insensitively; echo back the normalised value **[V]**.
- `masterPassphrase` matches `^[0-9a-f]{44}$`, is displayed **once**, and is the only recovery credential. Never persist it; never log it **[V]**.
- `access token` is a three-part JWT; `refreshToken` is opaque with prefix `bvr_` **[V]**.
- `POST /api/v1/account/login` — `200`, same body minus `masterPassphrase`, accepts the same optional `device` block, rate limit `max(8, BITVOID_AUTH_RATE_LIMIT_MAX)`/min/IP **[V]**. On throttling or lockout it may return a `Retry-After` header — honour it instead of retrying immediately **[V]**.
- `POST /api/v1/account/recover` — `200`, body `{ "masterPassphrase", "newPassword", "rotateRecoveryKey"?: true, "device"?: {...} }`; revokes **all** sessions and disconnects their sockets; returns a fresh `masterPassphrase` only when `rotateRecoveryKey` is true **[V]**.

### 6.2 `/me` (enveloped, nested)

`GET /api/v1/me` → `200`

```json
{
  "data": {
    "account": { "id": "usr_...", "username": "androiduser_01", "displayName": "..." },
    "node":    { "nodeId": "usr_...", "displayName": "...", "status": "active" },
    "device":  { "id": "dev_...", "platform": "android", "trustStatus": "trusted", "lastSeenAt": "..." },
    "session": { "id": "2f6c1e9a-8b4d-4c7e-9f01-3a5b6c7d8e9f", "expiresAt": "2026-11-27T19:00:00.000Z" }
  },
  "meta": { "requestId": "req-1", "serverTime": "2026-11-27T18:00:00.000Z" }
}
```

`PATCH /api/v1/me` accepts only `{ "displayName": "..." }` (1–64 chars) **[V]**.

> **ID formats [V]** — every id is `<prefix>_<32 hex chars>`:
>
> | Entity | Prefix | Entity | Prefix |
> |---|---|---|---|
> | Account / Node | `usr_` | Conversation | `cnv_` |
> | Device | `dev_` | Conversation message | `msg_` |
> | Event | `evt_` | Channel | `chn_` |
> | Attachment | `att_` | Channel message | `cmsg_` |
> | Live Class | `cls_` | WebRTC signal | `sig_` |
>
> **Session ids are the exception: bare UUIDs with no prefix.** Do not build a prefix-based parser over session ids, and do not assume a session id is opaque-prefixed when calling `DELETE /api/v1/sessions/:sessionId`.

### 6.3 Refresh and revocation

- `POST /api/v1/auth/refresh` — `200`, body `{ "refreshToken": "bvr_..." }`, unauthenticated, 20/min/IP. Returns a **new** access + refresh pair in a new session. The old refresh token is dead. Failure codes: `invalid_refresh_token`, `refresh_token_expired`, `refresh_token_reused` **[V]**.
  - **Client rule 1:** serialise refresh behind a single mutex. On `refresh_token_reused`, clear local credentials and force re-login — do not retry **[V]**.
  - **Client rule 2 (easy to get wrong):** a successful refresh **rotates the session**, so the Server closes the socket bound to the old session with close code `4001` ("Session rotated") **[V]**. That `4001` is *expected*, not a revocation: reconnect immediately with the new access token. Distinguish it by tracking whether the client itself just completed a refresh — `4001` arriving for a session the client never rotated is a genuine revocation.
- `POST /api/v1/auth/revoke` → `{ "data": { "revoked": true } }`; the token immediately returns `401 session_revoked` afterwards **[V]** (this exact sequence is contract-tested).
- `POST /api/v1/auth/revoke-others` — revokes every other session of the Node.
- `GET /api/v1/sessions`, `DELETE /api/v1/sessions/:sessionId` — session inventory for the account screen.
- `POST /api/v1/account/password` — `{ currentPassword, newPassword }`, revokes all **other** sessions (5/min) **[V]**.
- `POST /api/v1/account/recovery-key/rotate` — `{ currentPassword }`, returns a fresh one-time `masterPassphrase` (3/min) **[V]**.

### 6.4 Messaging

- `POST /api/v1/conversations` — `{ "type": "direct", "peerNodeId": "usr_..." }` or `{ "type": "group", "title": "...", "memberIds": [...] }` → `201` when created, `200` when an existing direct conversation is returned (`data.created` discriminates) **[V]**. Idempotent for direct conversations via a unique `direct_key`.
- `POST /api/v1/conversations/:id/messages` → `201 { "data": { "message": {...}, "deduplicated": false } }`; duplicate `clientMessageId` → `200` with `deduplicated: true` **[V]**. Body fields: `clientMessageId`, `kind` (`text` | `attachment`), `body` (≤8192 chars), `replyToMessageId`, `attachmentId`.
- `GET .../messages?beforeSeq=&afterSeq=&limit=` — cursor pagination, default 50, max 200.
- `PATCH`/`DELETE .../messages/:messageId` — edit own; soft-delete creates a tombstone and fans out `message.deleted`.
- `POST .../messages/:messageId/receipts` — `{ "status": "delivered" | "read" }`.
- `GET /api/v1/nodes/directory?q=&limit=` — Node search for starting conversations (active Nodes only).

### 6.5 Offline and multi-device sync

`GET /api/v1/sync/events?afterSeq=&limit=` — when `afterSeq` is omitted, the Server uses the saved **per-device** cursor **[V]**.

```json
{
  "data": {
    "events": [
      { "seq": 42, "eventId": "evt_...", "eventType": "message.created",
        "entityType": "message", "entityId": "msg_...", "payload": { }, "occurredAt": "..." }
    ],
    "cursor": 40,
    "nextCursor": 42,
    "hasMore": true
  }
}
```

- `eventType` values seen in Server source include `message.created`, `message.edited`, `message.deleted`, `message.receipt`, `conversation.created`, `conversation.member_added`, `conversation.member_removed`, `channel.created`, `channel.joined`, `channel.message_created`, `channel.message_deleted`, `live_class.created`, `live_class.started`, `live_class.ended`, `live_class.participant_joined`, `live_class.participant_left`, `live_class.signal` **[V]**. Treat unknown types as forward-compatible no-ops, not errors.
- `POST /api/v1/sync/cursor` — `{ "lastSeq": 42 }`; requires a device-bound session, else `400 device_required` **[V]**.
- `POST /api/v1/sync/outbox` — `{ "operations": [ ... ] }`, **1–100** operations. Accepted `type` values **[V]**:

| `type` | Required fields | Result on success |
|---|---|---|
| `conversation.message` | `conversationId`, `clientMessageId`, `body` (+ optional `kind`, `replyToMessageId`, `attachmentId`) | `{ clientMessageId, ok: true, deduplicated, message }` |
| `channel.message` | `channelId`, `clientMessageId`, `body` (+ optional `attachmentId`) | `{ clientMessageId, ok: true, deduplicated, message }` |
| `message.receipt` | `conversationId`, `messageId`, `status` | `{ clientMessageId, ok: true, receipt }` |

Anything else returns `ok: false` with `error.code = "unsupported_operation"` **[V]**. Results are positional per operation, and a failure in one operation does **not** abort the batch — the client must reconcile per `clientMessageId`, not by batch status.

### 6.6 Realtime WebSocket

`WS /api/v1/events`, authenticated only by the `Authorization: Bearer` handshake header **[V]**.

- First frame: `{ "eventId", "type": "connected", "serverId", "nodeId", "sessionId", "deviceId", "occurredAt" }` **[V]**.
- Client frames **[V]**: `{type:"ping", id}` → `{type:"pong", id}`; `{type:"subscribe", topic:"conversation:<id>"|"channel:<id>"|"live-class:<id>"}` → `subscribed` or `subscription_error`; `{type:"unsubscribe", topic}` → `unsubscribed`; `{type:"typing", conversationId, isTyping}`.
- Server pushes carry `eventId`, `seq` (durable events only), `type`, `entityType`, `entityId`, `payload`, `occurredAt` **[V]**.

**Close codes — do not auto-reconnect on the application codes** **[V]**:

| Code | Meaning | Client action |
|---|---|---|
| `1000` | Normal | Reconnect with backoff |
| `1003` | Invalid data | Fix the frame; log; do not loop |
| `1008` | Policy violation (e.g. token in query) | Fix the handshake; do not loop |
| `4001` | Session revoked — **or** rotated by a refresh the client just performed | If the client just refreshed: reconnect with the new token. Otherwise: clear session, stop reconnecting, re-auth |
| `4002` | Session expired | Refresh, then reconnect once |
| `4003` | Device revoked | Clear device credentials, re-enrol |
| `4004` | Node suspended | Show account-suspended state, no retry |
| `4005` | Server shutting down | Reconnect with backoff |

### 6.7 Discovery, trust and pinning

- mDNS: canonical `_bitvoid-server._tcp`, compatibility `_http._tcp`; TXT `serverId`, `api=v1`, `version`, `tls`, `mode`, `name`; automatically disabled in `vpn` mode **[V]**.
- `GET /api/v1/server/info` — `data.serverId`, `displayName`, `serverVersion`, `apiVersion`, `eventProtocolVersion` (`1`), `deploymentMode` (`self-hosted` | `centrally-hosted`), `networkMode` (`lan` | `hotspot` | `vpn`), `capabilities[]`, `transport` (`http` | `https`), `tls.{enabled,fingerprint256,validTo}`, `discovery`, `links` **[V]**.
- `capabilities[]` is the truthful feature registry — currently `account-auth`, `argon2id-passwords`, `device-registration`, `session-refresh`, `session-revocation`, `sqlite-persistence`, `websocket-events`, `encrypted-backups`, `direct-messaging`, `group-messaging`, `message-receipts`, `channels`, `live-classes`, `webrtc-signaling`, `attachments`, `durable-sync` **[V]**. **Gate client features on this list**, do not infer from version numbers.
- `GET /api/v1/server/trust-bundle` — `data.profile` (identity bootstrap for pinning), `data.lanEndpoints[]`, `data.vpnEndpoints[]` **[V]**. Discovery is advisory only: always confirm `serverId`, and when `tls.enabled` confirm `tls.fingerprint256` matches the pinned value **before** sending credentials.
- Trust rule **[P]**: a changed `serverId` or fingerprint on a saved profile must hard-stop and require explicit re-trust, never a silent accept.

---

## 7. Error taxonomy and required client behaviour

Standard error envelope **[V]**:

```json
{ "error": { "code": "validation_error", "message": "..." },
  "meta": { "requestId": "req-1", "serverTime": "..." } }
```

| `error.code` | HTTP | Client behaviour |
|---|---|---|
| `unauthenticated` | 401 | No/invalid `Authorization` header — attach the token and retry once |
| `validation_error` | 400 | Show field-level message; do not retry |
| `invalid_credentials` | 401 | Wrong password (also used for a wrong `currentPassword`); clear the field, count the attempt |
| `account_suspended` | 403 | Terminal state UI; no retry |
| `username_taken` | 409 | Inline suggestion on register |
| `slug_taken` | 409 | Inline suggestion on channel create |
| `invalid_recovery_key` | 401 | Clear recovery field; no retry |
| `invalid_token` / `session_revoked` / `session_expired` | 401 | Refresh once, then re-login |
| `device_revoked` / `device_required` | 401/400 | Re-enrol device |
| `invalid_refresh_token` / `refresh_token_expired` | 401 | Force re-login |
| `refresh_token_reused` | 401 | Force re-login; **never** retry the refresh |
| `rate_limited` | 429 | Honour `Retry-After` if present, else back off; surface "slow down" |
| `payload_too_large` | 413 | Check size before upload retry |
| `quota_exceeded` | 413 | Node storage quota exhausted — prompt cleanup, do not retry |
| `class_already_ended` / `class_not_live` | 409 | Re-fetch class state; disable the action |
| `recipient_not_in_class` | 404 | Target has left the class; refresh participant list |
| `not_found`, `message_not_found`, `channel_not_found`, `class_not_found`, `device_not_found`, `session_not_found`, `node_not_found`, `attachment_not_found` | 404 | Remove local entity, resync |
| `forbidden` | 403 | Hide the action |
| `unsupported_operation` | 200-in-body | Drop the outbox operation as permanently failed |
| `operation_failed` | 200-in-body | Outbox operation failed for a domain reason — inspect the per-operation error |
| `internal_error` | 500 | Retry with backoff, capped |

`meta.requestId` must be captured in client logs — it is the only correlation handle Server logs expose **[V]**.

**Contract discrepancy found while writing this document [V].** `SERVER-API-V1.md` §2 says tokens in query strings are "strictly rejected on both HTTP and WebSocket". Only the WebSocket does that literally (`1008`). Over HTTP, `authMiddleware` reads the `Authorization` header exclusively and never inspects the query string, so a query token yields a plain `401 unauthenticated`. The security outcome is equivalent (a query token never authenticates), but the wording overstates the mechanism; a client must not expect a distinct error code. Recorded here rather than silently repeated.

---

## 8. Offline queue and multi-device consistency

The model the client must implement **[V]** for Server semantics, **[P]** for the Android implementation:

1. **Local write first.** Persist the message locally with a generated `clientMessageId` (UUID) and state `pending`.
2. **Send with the id.** `POST .../messages` with `clientMessageId`, or batch via `/sync/outbox`. A `200 + deduplicated:true` or `201` both mean "accepted"; flip to `sent` and replace the local row with the Server `message.id`.
3. **Never generate a second id on retry.** A new id creates a duplicate, because the Server's idempotency key is the only duplicate defence.
4. **Track the durable cursor, not the socket.** On every foreground or reconnect: `GET /sync/events` (no `afterSeq` → Server uses the device cursor), apply events in `seq` order, then `POST /sync/cursor` with the highest applied `seq`.
5. **`hasMore: true` means loop** until drained before declaring synced.
6. **Multi-device:** the same Node on two devices gets independent cursors; each device replays its own stream. Receipts and reads therefore sync per device, not globally.
7. **Migration of the existing local store [P]:** map legacy outbox rows to the three accepted operation types; rows that cannot map must be surfaced to the user as unsent drafts, **never silently dropped**. This is the single highest-risk step in Phase 3 and needs an explicit inventory of legacy row types before code is written.

---

## 9. Security requirements

**[V]** Server-side enforcement the client must not fight; **[P]** client obligation.

- Credentials (access token, refresh token, `device.id`) in Android Keystore-backed AES-GCM storage; never in `SharedPreferences` plaintext, never in logs **[P]**.
- Tokens only in the `Authorization` header — no query strings, no URLs, no WebSocket subprotocols **[V]**.
- `android:usesCleartextTraffic` must be `false` for release; permitted only via a debug manifest overlay **[P]**.
- Production (VPN, centrally hosted, and any untrusted LAN) requires TLS plus pinned `tls.fingerprint256`; no trust-all `TrustManager`, no hostname-verifier override **[P]**.
- On `4001`–`4004` (except the rotation case that the client itself triggered by refreshing), purge tokens and cached plaintext message bodies before returning to the auth screen **[P]**.
- Never log `masterPassphrase`, `token`, `refreshToken`, or message bodies; Server logs already redact these **[V]**.
- Rate-limit awareness per IP: register `max(5, BITVOID_AUTH_RATE_LIMIT_MAX)`, login `max(8, ...)`, recover 5, password change 5, recovery-key rotate 3, refresh 20 (all per minute) **[V]**. Client retries must not amplify these.

---

## 10. Server capabilities that do not exist — do not build client UI for them

Verified absent from the Server at `9988e41` **[V]**:

- **No push notifications.** No FCM/APNs/notification endpoints exist anywhere in `src/`. Background delivery therefore depends on a live WebSocket (foreground service) or on `GET /sync/events` polling after resume. Any "message arrives while the app is killed" requirement is **unmeetable by the current Server** and needs a Phase 2/5 decision.
- **No presence/online-status API.** Only `typing` over WS exists.
- **No blocking/muting or archiving endpoints.** `conversations.archived_at`, `channels.archived_at` and `conversation_members.muted_until` exist as **schema columns only**. `archived_at` is *read* as a filter (archived conversations/channels are excluded from lists) but nothing in `src/` ever *writes* it; `muted_until` is never read or written at all. There is no API to archive or mute, so do not ship mute/archive switches against them.
- **No message search endpoint.**
- **No account self-deletion endpoint.** (Account lifecycle is a Server-side gap.)
- **No end-to-end encryption.** Server-side encryption of message bodies is not implemented; do not claim E2EE in the client.
- **No HTTP/WS administration surface.** All Server administration is local IPC only (Unix socket `0600` / Windows named pipe) — the Android app cannot and must not administer a Server.

---

## 11. Test plan

### 11.1 Android contract tests to add **[P]**

Port the Server's existing contract test (`test/contract/android-api-v1.test.js`, which already exercises health → server info → register → me → WS handshake + ping/pong → revoke → re-login → recover **[V]**) into Android instrumentation tests against a local Server instance:

1. Envelope parser handles both flat (`register`/`login`/`recover`) and wrapped (`me`, messaging, sync) shapes.
2. `/me` nesting maps to the app's account/session model without a null `device`.
3. Refresh mutex: 10 concurrent 401s produce exactly **one** `/auth/refresh`.
4. `refresh_token_reused` forces re-login and clears credentials.
5. Duplicate send with the same `clientMessageId` yields one message.
6. Outbox batch of 100 mixed operations reconciles per `clientMessageId`.
7. Sync replay from `afterSeq=0` reconstructs the same local state as live socket delivery.
8. Each close code `4001`–`4004` suppresses auto-reconnect, except `4001` immediately following a client-initiated refresh, which reconnects once with the new token; `1000`/`4005` reconnect with backoff.
9. `serverId` mismatch or fingerprint mismatch on a saved profile blocks connect.
10. No token appears in any URL, log line, or crash report.

### 11.2 Real device/host matrix **[P]**

| Scenario | Pass condition |
|---|---|
| Phone ↔ host on same LAN, no Internet | Register, login, send, receive, reconnect after host restart |
| Phone ↔ host over OS hotspot | Same, with TLS + pinning |
| Two sites over VPN | Same, through the VPN endpoint from the trust bundle, TLS required |
| Two devices, one Node | Independent cursors; no duplicated or missed messages |
| Airplane mode 10 min, then resume | Outbox flushes; nothing lost; no duplicates |
| Session revoked from another device | Live socket closes `4001`; app returns to login |
| Host offline at launch | Clear unreachable state; no credential loss |

### 11.3 CI gate **[P]**

Android CI must run the contract tests against the Server image for the released Server version, and fail on contract drift. Per Phase 1, Android builds and LAN tests were **not** run for the last merged Android PRs **[A]** — re-establishing green CI is a prerequisite, not a nice-to-have.

---

## 12. Phase 3 exit criteria checklist

Copied from [`PHASE-1-ARCHITECTURE-AUDIT.md` §9](./PHASE-1-ARCHITECTURE-AUDIT.md#9-phased-implementation-roadmap); all **unmet** as of this document.

- [ ] Android register / login / recovery passes automated contract tests.
- [ ] Device enrolment passes automated contract tests.
- [ ] Message send and receive pass automated contract tests.
- [ ] Reconnect passes automated contract tests.
- [ ] Offline queue passes automated contract tests.
- [ ] Sync passes automated contract tests.
- [ ] Real phone-to-host LAN tests pass.
- [ ] Legacy pairing and `/api/v1/users/register` calls removed.
- [ ] Embedded `BitVoidLocalServer` retired only after all dependents migrated.
- [ ] Cleartext restricted to debug builds; production profiles validated TLS.
- [ ] Local cached messages and pending outbox migrated with zero unsent-data loss.

---

## 13. Open questions to resolve in the AirMesh session

These cannot be answered from the Server repository and must be settled before Phase 3 code:

1. **Legacy inventory:** exact list of `/api/v1/pairing/request` and `/api/v1/users/register` call sites, and every legacy outbox row type in `BitVoidLocalStore`.
2. **Existing installs:** what happens to users already paired with an embedded Server who have no Server account? (Migration path or explicit one-time reset.)
3. **Background delivery:** given no push infrastructure exists, is a foreground service acceptable for the first release, or does Phase 2 need a push design before Phase 3 ships?
4. **QR/trust payload:** the Server exposes `profile` in the trust bundle but defines no QR format; the client must not invent an incompatible one.
5. **Scope decision:** confirm the embedded Server is retired in Phase 3 rather than a later phase, given Phase 5 owns network modes.
6. **Current-tree drift:** all `[A]` rows in Section 4 must be re-verified against the actual Android `main`, since Android work has continued since `7f2aa12`.

---

## 14. Change log

| Version | Date | Change |
|---|---|---|
| 1.0.0 | 2026-11-27 | Initial companion document. Satisfies the "Android integration companion document" deliverable of Phase 1 §9. Documentation only; no Android or Server code changed. |
