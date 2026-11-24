# BitVoid Cloud Backend · Render

Account identity and synchronization cloud for the browser-first BitVoid system. Campus local services are planned to remain usable without internet and keep a local copy of user data, syncing when reachable.

## Included in this milestone

- Register/login with bcrypt password hashes.
- JWT authentication, profile read/update and username search.
- Device registration.
- Versioned JSON snapshot sync with optimistic revisions and conflict responses.
- Change history endpoint.
- WebSocket relay for call signaling (not media).
- PostgreSQL persistence and Render deployment blueprint.

This is a foundation, not a production-ready calling service. WebRTC client integration, TURN/STUN, call permissions, email verification, password reset, session revocation, encrypted local storage, hardened sync merge logic, and security testing remain outstanding.

## Render deployment

1. Push branch and create a PR.
2. Deploy as a Render Blueprint from cloud-backend/render.yaml, or create a Docker web service with root directory cloud-backend.
3. Attach PostgreSQL and configure DATABASE_URL.
4. Ensure JWT_SECRET is long and random.
5. Set CORS_ORIGIN to the deployed web frontend origin (not wildcard for production).
6. Deploy and check /health.

Schema is automatically initialized at startup. PostgreSQL should support gen_random_uuid().

## API

POST /v1/auth/register body: username, optional email, password (10-128 chars), optional displayName/deviceKey.
POST /v1/auth/login body: login (username/email), password, optional deviceKey.
GET /v1/me with bearer token.
PATCH /v1/me body: displayName.
GET /v1/users/search?q=term (bearer).
POST /v1/devices/register body: deviceKey,label.
GET /v1/sync returns user's revision and JSON snapshot.
PUT /v1/sync body: baseRevision,payload. Stale revisions return HTTP 409 with server revision and payload.
GET /v1/sync/changes?after=revision.
WebSocket /v1/calls?token=JWT relays call-offer, call-answer, ice-candidate, call-end and call-reject messages. Relay message shape: {type,to,payload,callId}. No audio is relayed by this WebSocket; WebRTC carries media.

## Local/cloud account synchronization model

The local campus server will maintain a durable local user copy and local data. When a user registers while offline, local registration should succeed locally and enter an outbound sync queue. When internet is available, the local sync worker should create/resolve the cloud account and reconcile profile and sync payload. When the user signs in off-campus, the cloud account is available. Campus local access must not depend on cloud uptime.

We must design conflict handling before syncing chat history or other structured entities. This first API offers atomic JSON snapshot revisions as a primitive; it does not yet merge concurrent records or implement local synchronization.

## Security caveats

- Passwords are bcrypt-hashed (12 rounds).
- JWTs last 14 days.
- Rate limiting currently 100 requests per IP/minute; login/register need a stricter dedicated limiter before public release.
- WebSocket bearer token is in query string; switch to short-lived call-ticket or secure auth before production.
- Wildcard CORS is development default. Restrict to exact origins.
- No email verification, password recovery, refresh rotation, account deletion, TURN relay, or end-to-end encryption yet.
- Don't put private messages, passwords or audio in sync payload unless encryption and access control are implemented.
