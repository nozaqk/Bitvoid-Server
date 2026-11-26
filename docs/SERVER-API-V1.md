# BitVoid Server API v1

This contract describes the cross-platform application Server. The Server runs on Windows, Linux, or macOS and is reached directly by the native Android app over a private Wi-Fi/LAN connection. No ESP8266 or separate Gateway device is required.

## Network

- Default TCP port: 8787.
- Default bind address: 0.0.0.0.
- Local HTTP: http://HOST-LAN-IP:8787.
- Local WebSocket: ws://HOST-LAN-IP:8787/api/v1/events.
- TLS can be enabled on the Server with BITVOID_TLS_CERT and BITVOID_TLS_KEY; the Android client must validate the configured certificate before using HTTPS/WSS.
- Discovery is advisory. Verify GET /api/v1/server/info and its stable serverId before trusting an endpoint.
- The host computer and phone must be on the same private Wi-Fi/LAN. The Server does not provide Wi-Fi access-point functionality.

## HTTP conventions

JSON is UTF-8. Authenticated REST routes use Authorization: Bearer <account-token>. The Server uses opaque IDs, UTC ISO-8601 timestamps, standard HTTP status codes, and SQLite persistence.

## Implemented routes

| Method | Path | Authentication | Purpose |
|---|---|---|---|
| GET | /api/v1/health | No | Liveness/readiness |
| GET | /api/v1/server/info | No | Stable Server identity and capabilities |
| POST | /api/v1/account/register | No | Create account and initial session |
| POST | /api/v1/account/login | No | Create authenticated session |
| POST | /api/v1/account/recover | No | Reset password using recovery key |
| GET | /api/v1/me | Bearer | Return account identity |
| POST | /api/v1/auth/revoke | Bearer | Revoke current session |
| WS | /api/v1/events | Bearer header | Authenticated event connection and ping/pong heartbeat |

### Account payloads

Register and login accept JSON with username and password. Usernames are 2-24 characters using letters, numbers, dot, underscore, or hyphen. Passwords are 10-128 characters.

Register returns:
- account: account ID and normalized username.
- token: revocable account session token.
- masterPassphrase: one-time 44-character hexadecimal recovery key. Save it securely; the Server stores only its SHA-256 hash.

Login returns account and token.

Recovery accepts masterPassphrase and newPassword. It revokes existing sessions and returns a new account session.

Passwords are stored using bcrypt. Session tokens are signed and stored as SHA-256 hashes. Account endpoints are rate-limited.

## WebSocket

The client sends its bearer token in the HTTP Authorization header during the WebSocket handshake. The Server rejects invalid or revoked sessions. A connected client receives a connected event. A client ping message with an id receives a pong response.

The current implementation is only the authenticated connection and heartbeat foundation. Conversation subscriptions and message event fan-out are not implemented yet.

## Planned API areas

These features are not implemented yet and must not be advertised as available:
- Direct and group conversations, messages, history, and receipts.
- Channels and channel messages.
- Live Class metadata, membership, and signaling.
- Attachment upload/download.
- Durable offline synchronization and change cursors.
- Presence, typing indicators, and full real-time event fan-out.
- Admin management and account recovery lifecycle controls.

## Security

- Do not expose the Server directly to the public internet or create router port forwards.
- Restrict the host firewall rule to private networks.
- Keep BITVOID_TOKEN_SECRET and .env private.
- Use WPA2/WPA3 on the Wi-Fi network. Hidden SSIDs and MAC filtering are not meaningful substitutes for network encryption or application authentication.
- Default HTTP/WS transport is unencrypted and suitable only for a trusted private LAN. Enable TLS and validate the certificate in the Android app before using untrusted networks.
- TLS is transport encryption, not end-to-end encryption between users.
- Never put bearer tokens in URLs or query strings.
