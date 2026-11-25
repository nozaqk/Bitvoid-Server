# BitVoid

BitVoid is an **Android-app-only** communication system. There is no browser client, public website, PC web dashboard, or ESP web dashboard.

## Architecture

- **Android app** — the only user interface for registration, sign-in, conversations, messaging and supported calling features.
- **PC server** — local application API, device pairing, SQLite persistence, WebSocket events, attachments, and authenticated cloud synchronization.
- **Cloud backend** — remote account and synchronization APIs. It is an API service, not a website.
- **ESP-12E** — WPA2 Wi-Fi access point and discovery/health gateway only. It does not host a user interface or messaging application.

The PC server advertises its API as `bitvoid.local:8787`. Android devices and the PC must be connected to the same local network (for example, the ESP-12E access point). If mDNS is unavailable, use the PC's LAN IP.

## PC server

Use Node.js 22.13 or newer:

```powershell
cd pc-server
npm install
npm run check
npm start
```

The API listens on port 8787. The root and `/health` endpoints return service status; application APIs are under `/api/v1`. There are no HTML application or dashboard routes.

## ESP-12E

Open `esp12e-firmware/BitVoidESP12E/BitVoidESP12E.ino` in Arduino IDE. Copy `config.example.h` to the local, untracked `config.h`, configure the Wi-Fi and BVT-1 trust values, then flash the board. The ESP exposes only machine-readable gateway endpoints such as `/api/node`, `/api/v1/health`, and the authenticated internal status endpoint.

## Security

Use unique WPA2 credentials and independent 32+ character secrets for PC-to-cloud and PC-to-ESP authentication. Keep `.env` and `config.h` private. Use HTTPS for cloud connections. Do not expose the local HTTP server to the public internet.

No GitHub Actions workflows are used.
