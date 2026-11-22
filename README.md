# BitVoid Server

BitVoid's standalone local-network server and ESP-12E Wi-Fi access-point firmware.

This repository contains two independent projects:

- `pc-server/`: Node.js server for Windows and Linux PCs. It hosts BitVoid's local API, device pairing, messaging, rooms and WebSocket events.
- `esp12e-firmware/`: Arduino IDE firmware for an ESP-12E (ESP8266) that creates the BitVoid Wi-Fi network and exposes the Universal Gateway API v1 discovery endpoints.

## Network topology

```text
                 BitVoid Wi-Fi (ESP-12E)
                 SSID: configured by you
                         |
          +--------------+---------------+
          |              |               |
       Windows PC    Android phone   Other clients
       PC server      BitVoid app
       TCP :8787
```

The ESP-12E is the Wi-Fi access point; the PC runs the application server. Connect the PC and client devices to the ESP-12E network. The PC server binds to all interfaces and prints its Wi-Fi IPv4 address on startup. Clients use:

`http://<PC_WIFI_IP>:8787`

The ESP gateway itself is available at `http://192.168.4.1/api/v1/gateway/info`.

**Important:** ESP-12E is a Wi-Fi access point, not an internet router. This setup provides a local network. Its practical client capacity is limited; the default firmware setting is four clients. The PC must remain connected to the ESP access point while hosting.

## Requirements

- Node.js 22 or newer on the PC.
- Arduino IDE 2.x.
- ESP8266 board package installed in Arduino IDE.
- ESP-12E / ESP8266 board with a stable 3.3 V supply.
- USB-to-serial adapter with 3.3 V logic for boards without onboard USB.

## Start the PC server

```bash
cd pc-server
npm install
npm start
```

Windows PowerShell:

```powershell
cd pc-server
npm install
npm start
```

The server prints its LAN address, API base URL, WebSocket URL and pairing instructions. On first start, it creates a local data directory and a one-time administrator pairing code. Keep that code private.

## Flash the ESP-12E using Arduino IDE

1. Open `esp12e-firmware/BitVoidESP12E/BitVoidESP12E.ino`.
2. Copy `config.example.h` to `config.h` in the same sketch folder.
3. Change the SSID, WPA2 password, gateway ID and display name.
4. In Arduino IDE, install the **ESP8266** board package by the ESP8266 Community.
5. Select **Generic ESP8266 Module** (or the exact ESP-12E board profile you use), choose the correct flash size and serial port.
6. Compile and upload.
7. Connect the PC and phones to the configured BitVoid Wi-Fi.

The firmware exposes:
- `GET /api/v1/gateway/info`
- `GET /api/v1/health`
- `GET /api/v1/services`
- `GET /api/v1/devices`
- `GET /api/node` (legacy identity compatibility)

## Current implementation scope

The PC server provides a standalone local-first foundation: health and discovery, first-run administrator pairing, device tokens, users, direct conversations, rooms, persisted messages and authenticated WebSocket events.

This initial server is **not yet a drop-in replacement for every endpoint in the existing Android-hosted server**. In particular, Android's full media catalogue/upload/streaming, channel lifecycle, WebRTC call signaling and all legacy API routes still need explicit compatibility adapters and device-level integration testing. The ESP-12E firmware does not run the PC application server; it only provides Wi-Fi and gateway discovery.

No GitHub Actions workflow is used.

## Security notes

- Change the example Wi-Fi password before flashing.
- Never commit `config.h`, `.env`, or generated server data.
- Pairing codes are generated at runtime and should be shared only with intended devices.
- Device bearer tokens are stored as hashes on the PC.
- This is a local-network development server. Do not expose it directly to the public internet without a separate security review, TLS termination, rate limiting and hardened deployment configuration.

See [pc-server/README.md](pc-server/README.md) and [esp12e-firmware/README.md](esp12e-firmware/README.md).
