# BitVoid ESP-12E firmware (Arduino IDE)

This sketch turns an ESP-12E / ESP8266 into a small WPA2 Wi-Fi access point and exposes BitVoid Universal Gateway API v1 discovery and health endpoints. It also hosts its own lightweight, password-protected gateway dashboard. The PC runs the actual BitVoid application server and has a separate dashboard.

## Arduino IDE setup

1. Install Arduino IDE 2.x.
2. In File → Preferences, add Boards Manager URL: https://arduino.esp8266.com/stable/package_esp8266com_index.json
3. Open Boards Manager and install **esp8266 by ESP8266 Community**.
4. Install **ArduinoJson 6.x** using Library Manager.
5. Copy `BitVoidESP12E/config.example.h` to `BitVoidESP12E/config.h`.
6. Set a unique SSID, WPA2 password (8-63 characters), gateway ID and display name.
7. Set `BITVOID_ADMIN_USERNAME` and a unique `BITVOID_ADMIN_PASSWORD` of at least 12 characters. The firmware refuses to start while the example password remains.
8. Open `BitVoidESP12E/BitVoidESP12E.ino`, select the matching ESP8266 board profile (often Generic ESP8266 Module), flash size and serial port.
9. Upload and open Serial Monitor at 115200 baud.

## Separate local URLs

| Component | URL | Purpose |
|---|---|---|
| Main BitVoid application/API | `http://bitvoid.local:8787` | Used by BitVoid clients |
| PC server administrator | `http://pc-server.local:8787/admin` | PC server management; separate PC administrator account |
| ESP gateway administrator | `http://esp-server.local/admin` | ESP-12E gateway management; credentials from `config.h` |

The ESP dashboard uses HTTP Basic Authentication. Browsers display a username/password prompt before the dashboard or its protected status API is returned. The dashboard displays live values from the ESP itself: status, connected station count, uptime, free heap, SSID, AP IP/MAC, chip ID, flash size and ESP8266 core version. It does not expose the Wi-Fi password.

The `.local` names rely on mDNS and must be supported by the client device/network. If name resolution is unavailable, the ESP dashboard fallback is `http://192.168.4.1/admin`. The ESP address is fixed at `192.168.4.1`; the PC receives its own DHCP address on the ESP access point. The PC hostname is advertised by the PC server when its mDNS service is available.

## Gateway API

- ESP access point: configured SSID
- ESP gateway IP: `192.168.4.1`
- Gateway info: `http://192.168.4.1/api/v1/gateway/info`
- Health: `http://192.168.4.1/api/v1/health`
- Device count: `http://192.168.4.1/api/v1/devices`

Connect the PC to this SSID, start `pc-server/`, then connect Android clients to the same Wi-Fi and use the main BitVoid service URL.

## Hardware

Use a stable regulated 3.3 V supply with sufficient current for Wi-Fi transmit peaks. Use 3.3 V UART logic; never connect 5 V serial logic directly to ESP8266 RX. Ensure ESP8266 boot-strap pins GPIO0, GPIO2 and GPIO15 are in valid states. Default SoftAP capacity is four stations. The ESP does not bridge this network to the internet.

## Scope and security

The ESP dashboard is independent from the PC dashboard and uses credentials stored locally in the untracked `config.h`. Do not commit that file or reuse the Wi-Fi password as the dashboard password. HTTP Basic Authentication is not encrypted by itself; use only on the trusted local Wi-Fi network and do not expose the gateway to the public internet.

The ESP remains a Wi-Fi/discovery gateway only. It does not implement pairing, messaging, file storage, media or WebRTC. The PC dashboard will continue to report ESP telemetry as not reporting until PC-to-ESP heartbeat integration is implemented; the ESP's own dashboard shows its local hardware status directly.
