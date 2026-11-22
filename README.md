# BitVoid Server

Two independent projects in one repository:

- `pc-server/`: Node.js 22.13+ local BitVoid application server for Windows and Linux, including the protected web administrator dashboard.
- `esp12e-firmware/`: Arduino IDE sketch for ESP-12E / ESP8266 Wi-Fi access point and gateway discovery.

## Network

```text
ESP-12E SoftAP (192.168.4.1)
      |-- Windows/Linux PC running BitVoid server :8787
      |      |-- REST API + WebSocket messaging
      |      |-- SQLite persistence
      |      |-- Protected admin dashboard (/admin)
      |-- Android / desktop clients
      |-- Other local Wi-Fi devices
```

The ESP-12E supplies the local Wi-Fi network. The PC hosts the application API and dashboard. The PC server prints its Wi-Fi address and the matching dashboard URL at startup. Clients connect to `http://<PC_WIFI_IP>:8787`; administrators open `http://<PC_WIFI_IP>:8787/admin`. The ESP gateway info endpoint is `http://192.168.4.1/api/v1/gateway/info`.

## Start the PC server

```bash
cd pc-server
npm install
npm run check
npm start
```

Requires Node.js 22.13 or newer. On first start, copy the one-time dashboard setup code from the PC terminal into the dashboard, then create the administrator username and password. The dashboard includes live user sessions, paired devices, node inventory, message traffic, service status, uptime, search and activity history. See [PC server documentation](pc-server/README.md) for details.

## Upload ESP-12E firmware

1. Open `esp12e-firmware/BitVoidESP12E/BitVoidESP12E.ino` in Arduino IDE.
2. Copy `config.example.h` to `config.h` in the same sketch folder.
3. Set a unique SSID, strong WPA2 password, gateway ID and display name.
4. Install the ESP8266 board package and ArduinoJson 6.x.
5. Select your ESP-12E board/serial port and upload.

The ESP firmware is a Wi-Fi/discovery gateway, not the full messaging server. Default AP capacity is four clients. It does not provide internet routing.

## Current status

Implemented:
- PC HTTP API, gateway metadata and local SQLite persistence.
- Time-limited device pairing and device bearer tokens.
- User registration and direct/group messaging.
- Authenticated WebSocket message events.
- Protected administrator dashboard with first-run account setup, live monitoring, charts, user/device/node tables and activity log.
- ESP-12E SoftAP, mDNS and gateway discovery/health endpoints.

Not yet implemented or validated:
- Full compatibility with every existing BitVoid Android backend endpoint.
- Android client integration and automatic server discovery.
- ESP-to-PC heartbeat telemetry (the dashboard identifies the ESP gateway but reports its live state as not reporting until heartbeat integration exists).
- Media uploads/streaming, complete channels, attachments, WebRTC calls and push notifications.
- Production-grade physical pairing, TLS and public-network hardening.

This repository contains source code but has not yet been compiled on the target PC or flashed/tested on physical ESP-12E hardware. See the individual project READMEs and `docs/architecture.md`.

No GitHub Actions workflows are used.
