# BitVoid PC Server

The PC server is the **main local application server** for BitVoid. It is a headless backend service; the native Android application is the only user-facing interface. There is no browser messaging client, website, WebView portal, or web administration dashboard.

## Local-first responsibilities

- Local REST API and Android device pairing
- SQLite persistence for devices, users, conversations, messages, and attachments
- Authenticated WebSocket event connections
- Local message routing
- Attachment upload and download APIs
- ESP-12E gateway health monitoring over the local Wi-Fi network
- Optional authenticated PC-to-cloud synchronization (disabled by default)

## Requirements and run

Requires Node.js 22.13 or newer.

```powershell
npm install
Copy-Item .env.example .env
# Configure a private ESP trust secret matching the ESP config.h
npm run check
npm start
```

The server listens on `0.0.0.0:8787`. The Android app connects to `http://bitvoid.local:8787` when mDNS is available, or to the PC's LAN IP on port 8787.

## ESP-12E local Wi-Fi topology

1. Configure and flash the ESP-12E using `../esp12e-firmware/BitVoidESP12E`.
2. The ESP starts the `BitVoid_Local` WPA2 access point at `192.168.4.1`.
3. Connect the PC to the ESP access point.
4. Start the PC server.
5. Connect Android phones to the same Wi-Fi access point.
6. The Android app connects directly to the PC server on TCP port 8787.
7. The PC server polls the ESP's authenticated `/api/v1/internal/status` endpoint for gateway health.

The ESP provides Wi-Fi, discovery, and lightweight gateway status only. It does not host the BitVoid application API, route messages, or run a website. If using another local router instead of the ESP access point, connect the PC and phones to that same LAN.

Allow inbound TCP port 8787 through Windows Firewall on the Private network profile. Do not expose the local HTTP/WebSocket server to the public internet.

## Offline mode and cloud synchronization

Local pairing, user registration, conversations, messaging, WebSocket events, attachments, and SQLite persistence are local server functions. They do not require the cloud backend.

Cloud synchronization is opt-in and disabled by default:

```dotenv
BITVOID_CLOUD_SYNC_ENABLED=false
```

Keep it false for offline-only operation. When disabled, the PC server does not make cloud network requests and does not accumulate an unused cloud sync outbox. To enable cloud sync intentionally, set the flag to `true`, configure `BITVOID_CLOUD_SYNC_URL`, and set `BITVOID_PC_SERVER_SECRET` to the registered cloud trust secret. Cloud outages must not block local server startup or local messaging.

## Trust configuration

For ESP gateway health monitoring, configure these in the private `.env` file:

- `BITVOID_PC_SERVER_ID` — identity of this PC server; must match the ESP configuration.
- `BITVOID_ESP_TRUST_SECRET` — private secret shared only with the ESP configuration.
- `BITVOID_GATEWAY_ID` — expected ESP gateway identity.
- `BITVOID_GATEWAY_URL` — local gateway API address, normally `http://192.168.4.1`.

Cloud-only configuration:

- `BITVOID_CLOUD_SYNC_ENABLED=true`
- `BITVOID_CLOUD_SYNC_URL`
- `BITVOID_PC_SERVER_SECRET`
- `BITVOID_CLOUD_SERVER_ID`

Use separate random secrets of at least 32 characters for ESP trust and cloud trust. Never reuse the same secret for both systems.

## API overview

- `GET /` — JSON service metadata
- `GET /health` — process health
- `GET /api/v1/health` — API and optional cloud-sync status
- `GET /api/v1/gateway/info` — PC server capability metadata
- `GET /api/v1/services` — local service availability
- `POST /api/v1/pairing/request` and `POST /api/v1/pairing/approve` — device pairing
- `/api/v1/users/*` — local account operations
- `/api/v1/conversations/*` — conversations and messages
- `GET /api/v1/events` — authenticated WebSocket events
- `/admin/api/*` — private backend management APIs; no browser dashboard is shipped

The server returns JSON for unknown routes and does not serve HTML.

## Security

- Pair devices using a short-lived pairing challenge and administrator pairing code.
- Device access tokens are stored as SHA-256 hashes.
- ESP gateway status requires the configured PC server identity and ESP trust secret.
- Keep `.env` private.
- Use a trusted local Wi-Fi network and firewall the API to the Private network profile.
- Do not expose local HTTP or WebSocket endpoints directly to the public internet.

## Verification

Run `npm run check` for Node.js syntax checks. Full offline operation still requires an end-to-end test with a PC, Android device, and ESP-12E or another local Wi-Fi access point.
