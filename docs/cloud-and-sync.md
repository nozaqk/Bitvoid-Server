# BitVoid cloud and campus synchronization

## Deployment topology

- `cloud-server/`: public HTTPS API on Render, backed by Render PostgreSQL.
- `web-frontend/`: independent online browser client served as a Render Static Site.
- `pc-server/`: campus/local Node.js server with its existing SQLite database and local network API.
- `esp12e-firmware/`: ESP-12E provides local Wi-Fi access and gateway diagnostics only. It is not a database, cloud proxy or WebRTC server.

The Render blueprint at repository root creates the cloud API, static frontend and PostgreSQL database. The browser currently uses same-origin `/api/v1`; configure a reverse proxy or set `window.BITVOID_API_URL` to the cloud API origin when deploying the frontend and API on separate hostnames. The frontend must be served over HTTPS.

## Identity and credentials

Cloud accounts are globally authoritative. Cloud registration requires a verified-quality email format, unique username and a password of at least 12 characters. Passwords are salted and hashed with scrypt. Cloud-issued access tokens are not sync events. A campus-only registration must be represented as a pending local profile and must not be represented as a globally active account until cloud registration succeeds. Never upload plaintext passwords, password hashes, salts, access tokens or refresh tokens in sync payloads. The local service must not silently claim that an offline account is usable outside campus.

## Event protocol

Each event has:
- `eventId`: globally unique UUID; used as the idempotency key.
- `sourceNode`: stable campus node identifier supplied by the authenticated node.
- `ownerId`: cloud account UUID when the event belongs to a cloud account; otherwise null until identity is resolved.
- `entityType`, `entityId`: entity address.
- `revision`: monotonically increasing revision per entity at the source.
- `payload`: JSON object, never credentials.
- `sequence`: cloud-assigned append-only cursor.

Campus nodes authenticate with `X-BitVoid-Sync-Secret`. The cloud push endpoint accepts up to 250 events per request and deduplicates repeated event IDs. Pull requests use an exclusive numeric cursor and return ordered events. A campus client persists its last applied cursor only after applying the whole batch transactionally. Retries are safe because event IDs are idempotent.

## Conflict and deletion rules

The first event log is transport infrastructure, not a complete conflict resolver. Entity handlers must enforce per-entity revisions, reject stale updates, and record conflict metadata rather than blindly overwriting newer data. Deletions must be tombstone events; do not physically delete synchronized entities until all participating nodes have advanced beyond the tombstone. Cloud-managed account status and identity fields cannot be overwritten by campus-originated events.

## Current milestone

Implemented in this branch:
- Cloud registration, login, signed bearer sessions and account lookup.
- PostgreSQL schema for accounts, conversations, members, messages and append-only sync events.
- Direct/group conversation creation and message history/send endpoints.
- Idempotent cloud sync push and cursor-based pull endpoints.
- Independent responsive browser frontend for cloud account registration, login and text messaging.
- Render blueprint for cloud API, static frontend and managed PostgreSQL.

Not yet completed:
- Integrating the existing PC SQLite server with the sync endpoints and a durable local outbox.
- Account linking/claiming for campus-created pending profiles.
- Conflict-resolution handlers, tombstone retention and multi-campus node management.
- Browser WebSocket live updates, audio/WebRTC signaling, media and notifications.
- Deployment, database migration test, browser test, and physical campus/ESP-12E validation.

Do not expose the local PC server or ESP dashboard directly to the public internet. Use the cloud API for remote access; use the campus PC server only on the trusted campus network.
