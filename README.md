# BitVoid — ESP-12E Hardware Test Stage

BitVoid is being developed as an offline-first local communication system. **The current repository stage is intentionally limited to the ESP-12E gateway firmware.** The PC application server is not included yet; it will be designed and added after the ESP hardware and Wi-Fi behavior have been tested.

## Current test target

- ESP-12E / ESP8266 creates a WPA2 Wi-Fi access point.
- Default SSID: `BitVoid_Local`
- Gateway IP: `192.168.4.1`
- HTTP API: port `80`
- mDNS hostname: `esp-server.local`
- Default maximum stations: `4`
- Provides health, gateway metadata, service status, connected-station count, and discovery identity.
- No internet connection is required.
- No PC application server, messaging server, Android client integration, website, dashboard, captive portal, or WebView is part of this test stage.

The ESP is currently being tested as a standalone local Wi-Fi gateway. Do not expect chat, pairing, channels, or live classes to work yet. Those application features will be built after the gateway tests pass.

## Repository structure

```text
Bitvoid-Server/
├── esp12e-firmware/
│   ├── BitVoidESP12E/
│   │   ├── BitVoidESP12E.ino
│   │   └── config.example.h
│   └── README.md
└── README.md
```

## Hardware requirements

- ESP-12E module
- Stable regulated 3.3 V supply capable of handling Wi-Fi transmit-current peaks
- USB-to-serial adapter with 3.3 V UART logic
- Common ground between ESP and adapter

Do not connect 5 V UART logic directly to ESP8266 RX. A weak USB-to-serial 3.3 V output may not supply enough current for Wi-Fi; use a suitable regulator.

## Arduino IDE installation

1. Install Arduino IDE 2.x.
2. Add the ESP8266 Boards Manager URL:
   `https://arduino.esp8266.com/stable/package_esp8266com_index.json`
3. Install **esp8266 by ESP8266 Community** in Boards Manager.
4. Install **ArduinoJson 6.x** from Library Manager.
5. Open `esp12e-firmware/BitVoidESP12E/BitVoidESP12E.ino`.
6. Copy `config.example.h` to `config.h` in the same sketch folder.
7. Set a private WPA2 password of 8–63 characters and a unique random ESP trust secret of at least 32 characters. Keep `config.h` private; it is ignored by Git.
8. Select **Generic ESP8266 Module** (or the exact ESP-12E board profile), select the correct COM port, and upload.
9. Open Serial Monitor at **115200 baud**, reset the board, and look for `GATEWAY READY`.

The PC server identity and trust secret fields are reserved for a later server integration. They do not mean a PC server is currently included. Keep the IDs and secret stable and private for the later integration.

## First hardware test

Join the ESP Wi-Fi from a phone or PC. Use the password configured in your private `config.h`.

| Test | URL | Expected result |
|---|---|---|
| Root identity | `http://192.168.4.1/` | JSON identifies BitVoid ESP gateway |
| Health | `http://192.168.4.1/api/v1/health` | `ok: true`, `status: ready` |
| Gateway metadata | `http://192.168.4.1/api/v1/gateway/info` | ESP-12E model, IP, capabilities |
| Services | `http://192.168.4.1/api/v1/services` | Wi-Fi, discovery, health available; messaging unavailable |
| Connected stations | `http://192.168.4.1/api/v1/devices` | Current connected-station count |
| Discovery identity | `http://192.168.4.1/api/node` | Gateway node identity |

Connect a second device and check that the station count increases. Disconnect it and check that the count decreases. Repeat the health request over several minutes to check stability.

The `/api/v1/internal/status` endpoint is protected and should return HTTP 401 when opened without the expected PC identity and trust headers. This endpoint is reserved for the future local server integration.

## Scope after ESP testing

Only after the ESP-12E access point, endpoints, station counting, and stability tests pass will we design and add the PC application server. That future server will provide application data persistence, pairing, messaging, channels, Live Classes, and the REST/WebSocket API used by the Android app. The ESP will remain the Wi-Fi gateway, not the application server.

## Security

- Use a unique WPA2 password.
- Use a unique random 32+ character ESP trust secret.
- Never commit or share `config.h`.
- This test gateway uses local HTTP; it is not encrypted TLS transport.
- Do not expose the gateway directly to the public internet.

No GitHub Actions workflows are used.
