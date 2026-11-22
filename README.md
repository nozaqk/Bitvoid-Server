# BitVoid Server

Two independent components in one repository:

- `pc-server/`: Node.js 22.13+ local BitVoid application server for Windows and Linux, including the protected PC administrator dashboard.
- `esp12e-firmware/`: Arduino IDE sketch for ESP-12E / ESP8266 Wi-Fi access point, gateway discovery and its own protected gateway dashboard.

## Separate local URLs

| Component | URL | Login |
|---|---|---|
| Main BitVoid service/API | `http://bitvoid.local:8787` | BitVoid client authentication |
| PC server dashboard | `http://pc-server.local:8787/admin` | PC dashboard administrator account |
| ESP gateway dashboard | `http://esp-server.local/admin` | ESP credentials in the local, untracked `config.h` |

These are distinct local hostnames. The PC server advertises `bitvoid.local` and `pc-server.local` using mDNS/Bonjour; the ESP advertises `esp-server.local`. They are intended for devices on the same local network with mDNS support. IP-based fallback addresses are printed or documented for networks that block mDNS, but the dashboard URLs are the named hostnames above.

The dashboards are separate: the PC dashboard manages application users, paired devices, conversations, service status and activity. The ESP dashboard manages and reports the gateway's own Wi-Fi and hardware status. The ESP dashboard does not replace the PC dashboard, and the ESP does not host the BitVoid messaging API.

## Network layout

```text
ESP-12E SoftAP (192.168.4.1, esp-server.local)
      |-- PC running BitVoid server :8787
      |      |-- Main app/API: bitvoid.local:8787
      |      |-- PC dashboard: pc-server.local:8787/admin
      |      |-- REST API + WebSocket messaging
      |      |-- SQLite persistence
      |-- Android / desktop clients
      |-- Other local Wi-Fi devices

ESP dashboard: http://esp-server.local/admin
```

## Start the PC server

Before starting, copy pc-server/.env.example to pc-server/.env and set the ESP dashboard username/password to match the ESP local config.h. The PC server uses these credentials for authenticated gateway health polling. Keep both configuration files private; neither should be committed.

```bash
cd pc-server
npm install
npm run check
npm start
```

Requires Node.js 22.13 or newer. On first start, copy the one-time PC dashboard setup code from the PC terminal into the PC dashboard, then create the PC administrator username and password.

## Upload ESP-12E firmware

1. Open `esp12e-firmware/BitVoidESP12E/BitVoidESP12E.ino` in Arduino IDE.
2. Copy `config.example.h` to `config.h` in the same sketch folder.
3. Set a unique Wi-Fi SSID/password, gateway ID and display name.
4. Set a separate ESP dashboard username and password (at least 12 characters).
5. Install the ESP8266 board package and ArduinoJson 6.x.
6. Select your ESP-12E board/serial port and upload.
7. Connect to the ESP Wi-Fi and open `http://esp-server.local/admin`. If mDNS is unavailable, use `http://192.168.4.1/admin`.

The ESP dashboard displays live status, connected station count, uptime, free heap, SSID, AP IP/MAC, chip ID, flash size and ESP8266 core version. The dashboard never displays the Wi-Fi password.

## Current implementation status

Implemented in source:
- PC HTTP API, gateway metadata and local SQLite persistence.
- Time-limited device pairing and device bearer tokens.
- User registration and direct/group messaging.
- Authenticated WebSocket message events.
- PC administrator dashboard with first-run account setup, live monitoring, charts, user/device/node tables and activity log.
- PC mDNS hostnames for the main service and PC dashboard.
- ESP-12E SoftAP, mDNS hostname `esp-server.local`, gateway discovery/health endpoints.
- Independent password-protected ESP gateway dashboard with live local hardware diagnostics.

Not yet implemented or validated:
- Full compatibility with every existing BitVoid Android backend endpoint.
- Android client integration and automatic server discovery.
- Authenticated ESP-to-PC gateway health polling every 10 seconds, with online/offline state, latency, last-seen time and hardware telemetry in the PC dashboard. Requires matching credentials in PC .env and ESP config.h.
- Media uploads/streaming, complete channels, attachments, WebRTC calls and push notifications.
- Production-grade physical pairing, TLS and public-network hardening.

This repository contains source code but has not yet been compiled on the target PC or flashed/tested on physical ESP-12E hardware. mDNS behavior depends on client OS, network multicast support and firewall configuration. See the individual project READMEs and `docs/architecture.md`.

No GitHub Actions workflows are used.
