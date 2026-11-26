# BitVoid — Gateway Hardware Test Stage

BitVoid is an offline-first local communication system. This repository currently contains the **Gateway firmware**. The separate application Server is planned after the Gateway's Wi-Fi, discovery, and stability tests pass.

## Architecture

- **Android app:** only user-facing client.
- **Gateway:** provides local Wi-Fi, health, and discovery only.
- **Application Server:** a separate headless service that will provide pairing, authentication, messaging, channels, Live Classes, persistence, and synchronization.
- The Android app will connect directly to the Server over the local Wi-Fi network. The Gateway is not an application API proxy.

## Current hardware test target

- Hardware: ESP-12E / ESP8266.
- Default SSID: `BitVoid_Local`.
- Gateway IP: `192.168.4.1`.
- Gateway HTTP API: port `80`.
- Gateway mDNS hostname: `bitvoid-gateway.local`.
- Default maximum stations: `4`.
- No internet connection is required.
- The Gateway does not provide chat, pairing, channels, Live Classes, or application persistence.

## Firmware structure

```text
Bitvoid-Server/
├── docs/
│   └── SERVER-API-V1.md
└── esp12e-firmware/
    └── BitVoidESP12E/
        ├── BitVoidESP12E.ino
        └── config.example.h
```

## Arduino IDE setup

1. Install Arduino IDE 2.x.
2. Add Boards Manager URL: `https://arduino.esp8266.com/stable/package_esp8266com_index.json`.
3. Install **esp8266 by ESP8266 Community**.
4. Install **ArduinoJson 6.x**.
5. Open `esp12e-firmware/BitVoidESP12E/BitVoidESP12E.ino`.
6. Copy `config.example.h` to `config.h` beside the sketch.
7. Set a private WPA2 password (8–63 characters) and unique random 32+ character trust secret. Keep `config.h` private; it is ignored by Git.
8. Select the matching ESP-12E / Generic ESP8266 Module board and correct COM port.
9. Upload and open Serial Monitor at 115200 baud. Look for `GATEWAY READY`.

## Gateway tests

Join `BitVoid_Local` and test:

| Test | URL | Expected result |
|---|---|---|
| Root identity | `http://192.168.4.1/` | Gateway identity JSON |
| Health | `http://192.168.4.1/api/v1/health` | `ok: true`, `status: ready` |
| Gateway metadata | `http://192.168.4.1/api/v1/gateway/info` | Gateway ID, IP, capabilities |
| Services | `http://192.168.4.1/api/v1/services` | Wi-Fi, discovery, health available; messaging unavailable |
| Connected stations | `http://192.168.4.1/api/v1/devices` | Current station count |
| Discovery identity | `http://192.168.4.1/api/node` | Gateway node identity |

The protected `/api/v1/internal/status` endpoint must reject requests without the configured Server identity and trust headers. Those headers are only for Server-to-Gateway management/telemetry; they are not app-user authentication.

## Future application Server contract

The shared REST/WebSocket API contract is in [docs/SERVER-API-V1.md](docs/SERVER-API-V1.md). Planned defaults:

- Server TCP port: `8787`.
- Preferred hostname: `bitvoid-server.local`.
- DNS-SD service: `_bitvoid-server._tcp.local.`.
- REST root: `/api/v1`.
- WebSocket: `/api/v1/events`.

The Server will be a separate device connected to the Gateway Wi-Fi. It will have its own DHCP address. The app must discover and verify that Server address and connect directly to it. Do not assume the Server is at `192.168.4.1`.

## Security

- Use a unique WPA2 password and private 32+ character Gateway trust secret.
- Never commit `config.h`.
- The Gateway test API uses local HTTP and is not encrypted TLS transport.
- Do not expose the Gateway directly to the public internet.
- The app authenticates to the application Server with device tokens; the Gateway trust secret is never an app credential.

No GitHub Actions workflows are used.
