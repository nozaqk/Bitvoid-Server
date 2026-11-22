# BitVoid PC Server

Node.js 22.13+ server for Windows and Linux.

## Install and run

```bash
npm install
npm start
```

Windows PowerShell:

```powershell
npm install
npm start
```

The first start creates `.state/bitvoid.sqlite` and `.state/admin-pairing-code.txt`. The pairing code is printed to the terminal. Keep `.state/` private and never commit it.

The server defaults to `0.0.0.0:8787`. Optional variables are documented in `.env.example`; set them in your shell before starting Node.

## Pair a device

Request a short-lived challenge:

```http
POST /api/v1/pairing/request
Content-Type: application/json

{"deviceId":"android-phone-01"}
```

Approve it using the one-time administrator code printed in the PC terminal:

```http
POST /api/v1/pairing/approve
Content-Type: application/json

{"challengeId":"<challengeId>","adminCode":"<terminal-code>"}
```

The response contains a device-scoped bearer token. Store it securely on the client; the server stores only its SHA-256 hash. This bootstrap uses a terminal-shared administrator code, not physical-button or public-key pairing. Harden this before production use.

Register a username:

```http
POST /api/v1/users/register
Authorization: Bearer <deviceToken>
Content-Type: application/json

{"username":"alice"}
```

## API

| Method | Path | Purpose |
|---|---|---|
| GET | `/api/v1/gateway/info` | Gateway metadata |
| GET | `/api/v1/health` | Health and uptime |
| GET | `/api/v1/services` | Capability list |
| GET | `/api/v1/devices` | Paired device list |
| POST | `/api/v1/pairing/request` | Create 120-second challenge |
| POST | `/api/v1/pairing/approve` | Approve and issue device token |
| POST | `/api/v1/users/register` | Register paired device username |
| GET | `/api/v1/me` | Current device and user |
| POST | `/api/v1/conversations` | Create direct or group conversation |
| GET | `/api/v1/conversations` | List user's conversations |
| GET | `/api/v1/conversations/:id/messages` | Read history |
| POST | `/api/v1/conversations/:id/messages` | Send a message |
| WS | `/api/v1/events?token=...` | Authenticated real-time events |

WebSocket message events are sent only to connected members of the conversation. Send `{"type":"ping"}` to receive a pong.

## ESP-12E network

1. Flash the sibling `esp12e-firmware/` sketch.
2. Connect the PC to the ESP-12E SSID.
3. Start this server.
4. Use the PC Wi-Fi IP printed at startup, e.g. `http://192.168.4.2:8787`. The exact IP is assigned by DHCP and may differ.
5. Connect phones to the same Wi-Fi and use the PC URL.

If Windows Firewall prompts for Node.js, allow it on Private networks only. Do not create a public-network exception.

## Limitations

This is the first standalone server milestone. It provides pairing bootstrap, user registration, persisted conversations/messages and WebSocket delivery. It does not yet implement all legacy Android-hosted server routes, complete channel semantics, media uploads/streaming, file attachments, WebRTC signaling/audio, push notifications or automatic Android gateway discovery. It is not yet a drop-in replacement for the full Android backend.

Node's built-in `node:sqlite` requires Node.js 22.13+. Some Node releases print an experimental warning.
