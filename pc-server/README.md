# BitVoid PC Server

Node.js 22.13+ server for Windows and Linux. It hosts the BitVoid API, local SQLite database, WebSocket messaging, and the protected PC administrator dashboard.

## Separate local addresses

| Component | URL | Purpose |
|---|---|---|
| Main BitVoid application/API | `http://bitvoid.local:8787` | API used by BitVoid clients |
| Campus browser client | `http://bitvoid.local:8787/app` | Local device pairing and campus text messaging |
| PC server administrator | `http://pc-server.local:8787/admin` | PC server management; protected by the PC dashboard account |
| ESP gateway administrator | `http://esp-server.local/admin` | ESP-12E management; protected by separate ESP credentials |

The PC process advertises `bitvoid.local` and `pc-server.local` over mDNS using Bonjour. The ESP firmware independently advertises `esp-server.local`. These names work on devices whose network stack supports mDNS and while all devices are on the same local Wi-Fi network. If name resolution is unavailable, use the PC's LAN IP printed in the terminal as a fallback; the ESP dashboard fallback is `http://192.168.4.1/admin`.

The PC dashboard is deliberately not the main application URL. It is served at the dedicated `pc-server.local:8787/admin` address and uses its own first-run administrator account. The ESP dashboard uses its own credentials configured in the ESP firmware's untracked `config.h`.

## Install and run

```bash
cd pc-server
copy .env.example .env
# Edit .env and enter the ESP dashboard username/password
npm install
npm run check
npm start
```

Requires Node.js 22.13 or newer. On first start, the server creates a one-time PC dashboard setup code in `.state/admin-setup-code.txt` and prints it in the PC terminal. Open the PC dashboard, enter that code, choose an administrator username, and create a password of at least 12 characters. The setup code is deleted after successful setup. Keep the `.state/` directory private.

The dashboard uses an HttpOnly, SameSite=Strict session cookie, in-memory 12-hour sessions, password hashing with Node's scrypt, and basic login-attempt throttling. Restarting the server ends all dashboard sessions. Do not expose this HTTP dashboard to the public internet; it is intended for a trusted local network. Add TLS and stronger operational controls before remote/public deployment.

## Campus browser client

Open `http://bitvoid.local:8787/app` on a phone or computer connected to the campus Wi-Fi. The browser requests a short-lived device-pairing challenge; enter the administrator pairing code printed in the PC terminal, then choose a local username. The browser stores its device bearer token in that browser profile and can then create direct conversations and send/read text messages. This client talks only to the campus PC server; it does not require internet access. Local profiles are marked pending cloud link until a cloud account-linking flow is completed.

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

Online means a user currently has an authenticated WebSocket connection to the PC server. The PC server polls the ESP protected /admin/api/status endpoint every 10 seconds using HTTP Basic Authentication. Set BITVOID_GATEWAY_URL, BITVOID_GATEWAY_ADMIN_USERNAME and BITVOID_GATEWAY_ADMIN_PASSWORD in .env; credentials must match the ESP firmware config.h. The PC dashboard then displays actual online/offline status, last check/last seen, response latency, connected clients, uptime, free heap, SSID, MAC and firmware core version. Missing credentials are reported as Not configured; unreachable ESP or rejected credentials are reported as Offline with a diagnostic. The ESP admin password is never returned by the PC dashboard API.

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
| POST | `/api/v1/account/register` | Create username/password account and issue one-time master recovery passphrase |
| POST | `/api/v1/account/login` | Username/password account login |
| POST | `/api/v1/account/recover` | Reset password using the 44-character hexadecimal master passphrase |
| POST | `/api/v1/account/password/change` | Change password for an authenticated account |
| POST | `/api/v1/pairing/request` | Create 120-second challenge |
| POST | `/api/v1/pairing/approve` | Approve and issue device token |
| POST | `/api/v1/users/register` | Register paired device username |
| GET | `/api/v1/me` | Current device and user |
| POST | `/api/v1/conversations` | Create direct or group conversation |
| GET | `/api/v1/conversations` | List user's conversations |
| GET | `/api/v1/conversations/:id/messages` | Read history |
| POST | `/api/v1/conversations/:id/messages` | Send a message |
| WS | `/api/v1/events?token=...` | Authenticated real-time events |

## ESP gateway heartbeat configuration

1. On the ESP, set BITVOID_ADMIN_USERNAME and BITVOID_ADMIN_PASSWORD in its local config.h.
2. In pc-server/, copy .env.example to .env.
3. Set BITVOID_GATEWAY_URL=http://192.168.4.1 and enter the exact ESP dashboard username/password in BITVOID_GATEWAY_ADMIN_USERNAME and BITVOID_GATEWAY_ADMIN_PASSWORD.
4. Keep .env private; it is ignored by Git. Never commit the credentials.
5. Restart the PC server. It checks the gateway immediately and then every 10 seconds.

The monitor uses a 3-second request timeout. The PC must be connected to the ESP access point and able to reach 192.168.4.1. It polls only the protected, read-only status endpoint; it cannot change ESP settings or reboot the gateway.

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


### Account authentication and recovery

The PC server supports the same account endpoints as BitVoid Cloud. Registration accepts a username and password (minimum 10 characters) and returns a 44-character hexadecimal master passphrase exactly once. The server stores a scrypt password verifier and a SHA-256 lookup digest of the high-entropy recovery secret; it never stores the master passphrase itself. Recovery accepts the master passphrase and a new password and does not require the username. Keep an offline copy of the master passphrase. These local accounts are stored on this PC server; they are not automatically synchronized with cloud account credentials.
