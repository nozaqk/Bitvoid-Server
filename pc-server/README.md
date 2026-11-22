# BitVoid PC Server

Node.js 22.13+ server for Windows and Linux. It hosts the BitVoid API, local SQLite database, WebSocket messaging, and the protected PC administrator dashboard.

## Separate local addresses

| Component | URL | Purpose |
|---|---|---|
| Main BitVoid application/API | `http://bitvoid.local:8787` | Used by BitVoid clients |
| PC server administrator | `http://pc-server.local:8787/admin` | PC server management; protected by the PC dashboard account |
| ESP gateway administrator | `http://esp-server.local/admin` | ESP-12E management; protected by separate ESP credentials |

The PC process advertises `bitvoid.local` and `pc-server.local` over mDNS using Bonjour. The ESP firmware independently advertises `esp-server.local`. These names work on devices whose network stack supports mDNS and while all devices are on the same local Wi-Fi network. If name resolution is unavailable, use the PC's LAN IP printed in the terminal as a fallback; the ESP dashboard fallback is `http://192.168.4.1/admin`.

The PC dashboard is deliberately not the main application URL. It is served at the dedicated `pc-server.local:8787/admin` address and uses its own first-run administrator account. The ESP dashboard uses its own credentials configured in the ESP firmware's untracked `config.h`.

## Install and run

```bash
cd pc-server
npm install
npm run check
npm start
```

Requires Node.js 22.13 or newer. On first start, the server creates a one-time PC dashboard setup code in `.state/admin-setup-code.txt` and prints it in the PC terminal. Open the PC dashboard, enter that code, choose an administrator username, and create a password of at least 12 characters. The setup code is deleted after successful setup. Keep the `.state/` directory private.

The dashboard uses an HttpOnly, SameSite=Strict session cookie, in-memory 12-hour sessions, password hashing with Node's scrypt, and basic login-attempt throttling. Restarting the server ends all dashboard sessions. Do not expose this HTTP dashboard to the public internet; it is intended for a trusted local network. Add TLS and stronger operational controls before remote/public deployment.

## Dashboard features

- Password-protected administrator sign-in and first-run setup.
- Overview cards for registered users, live connected users, paired devices and known nodes.
- Live dashboard refresh every five seconds.
- 24-hour message traffic chart.
- Service health and server uptime/runtime information.
- User table with online/offline status, IDs and registration time.
- Paired device table with assigned username and last-seen information.
- Network node view for the PC coordinator and ESP-12E gateway.
- Recent activity feed and activity log.
- Search for users and paired devices.
- Responsive dark interface for desktop and mobile screens.

Online means a user currently has an authenticated WebSocket connection to the PC server. The ESP-12E appears as a known gateway component, but its live health in the PC dashboard is reported as "not reporting" until gateway heartbeat integration exists. The ESP's own dashboard displays live hardware values locally.

## Pair a device

Request a short-lived challenge:

```http
POST /api/v1/pairing/request
Content-Type: application/json

{"deviceId":"android-phone-01"}
```

Approve it using the one-time administrator pairing code printed in the PC terminal:

```http
POST /api/v1/pairing/approve
Content-Type: application/json

{"challengeId":"<challengeId>","adminCode":"<terminal-code>"}
```

The response contains a device-scoped bearer token. Store it securely on the client; the server stores only its SHA-256 hash. This bootstrap uses a terminal-shared administrator code, not physical-button or public-key pairing. Harden this before production use.

## API

| Method | Path | Purpose |
|---|---|---|
| GET | `/admin` | Protected PC administrator dashboard |
| GET | `/admin/api/overview` | Dashboard metrics (admin session required) |
| GET | `/admin/api/users` | User list (admin session required) |
| GET | `/admin/api/devices` | Paired devices (admin session required) |
| GET | `/admin/api/nodes` | Known network nodes (admin session required) |
| GET | `/admin/api/activity` | Activity log (admin session required) |
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

## ESP-12E network

1. Flash the sibling `esp12e-firmware/` sketch with its own dashboard credentials.
2. Connect the PC to the ESP-12E SSID.
3. Start this server.
4. Use `http://bitvoid.local:8787` for the main BitVoid service and `http://pc-server.local:8787/admin` for PC administration.
5. Open `http://esp-server.local/admin` for ESP gateway administration.
6. If mDNS does not resolve, use the printed PC LAN IP or `http://192.168.4.1/admin` for the ESP.

If Windows Firewall prompts for Node.js, allow it on Private networks only. mDNS discovery may also require allowing Bonjour/mDNS multicast on the Private network. Do not create a public-network exception.

## Limitations and security notes

This remains the first standalone server milestone. It does not yet implement all legacy Android-hosted server routes, complete channel semantics, media uploads/streaming, file attachments, WebRTC signaling/audio, push notifications or automatic Android gateway discovery. It is not yet a drop-in replacement for the full Android backend.

Admin sessions are stored in memory and expire after 12 hours. HTTP and WebSocket traffic are unencrypted on the local network. ESP HTTP Basic Authentication is also unencrypted without TLS. Do not expose either dashboard or service to the public internet.

Node's built-in `node:sqlite` requires Node.js 22.13+. Some Node releases print an experimental warning. Source has not been compiled on the target PC or flashed/tested on physical ESP-12E hardware.

No GitHub Actions workflows are used.
