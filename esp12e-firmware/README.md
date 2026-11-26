# BitVoid ESP-12E — Standalone Hardware Test

The ESP-12E is currently being tested as a **standalone local Wi-Fi access point and discovery/health gateway**. The PC application server is deliberately not in this repository stage; we will build it after the ESP tests pass.

This firmware does not provide chat, pairing, channels, Live Classes, a dashboard, a captive portal, or internet routing. It provides the Wi-Fi network and basic machine-readable gateway endpoints only.

## Hardware and power

- ESP-12E / ESP8266 module
- Stable regulated 3.3 V supply capable of handling Wi-Fi transmit-current peaks
- USB-to-serial adapter with 3.3 V UART logic
- Common ground between ESP and adapter

Never connect 5 V UART TX directly to ESP RX. Do not rely on a weak USB-to-serial 3.3 V pin if it cannot supply the ESP's Wi-Fi current peaks.

For a typical bare ESP-12E upload, connect adapter TX to ESP RX, adapter RX to ESP TX, and GND to GND. Supply regulated 3.3 V, keep EN/CH_PD high, and pull GPIO0 low during reset/upload. Release GPIO0 from GND and reset again for normal boot. Follow the exact boot-strapping requirements of your board/adapter.

## Arduino IDE setup

1. Install Arduino IDE 2.x.
2. Add the ESP8266 Boards Manager URL: `https://arduino.esp8266.com/stable/package_esp8266com_index.json`.
3. Install **esp8266 by ESP8266 Community** in Boards Manager.
4. Install **ArduinoJson 6.x** from Library Manager.
5. Open `BitVoidESP12E/BitVoidESP12E.ino`.
6. Copy `BitVoidESP12E/config.example.h` to `BitVoidESP12E/config.h` in the same folder.
7. Set a unique WPA2 password (8–63 characters) and a random trust secret of at least 32 characters. Keep `config.h` private; Git ignores it.
8. The PC server ID and trust secret are reserved for future server integration. Keep their values private and stable; no PC server is included at this stage.
9. Select **Generic ESP8266 Module** (or the matching ESP-12E profile), select the correct COM port, and upload.
10. Open Serial Monitor at **115200 baud**, press RESET, and confirm `GATEWAY READY`.

The example config intentionally contains placeholders and the sketch will refuse to start until you configure a real password and trust secret.

## Standalone test

Join the configured `BitVoid_Local` Wi-Fi from a phone or PC. The default gateway is `192.168.4.1`.

| Test | URL |
|---|---|
| Gateway identity | `http://192.168.4.1/` |
| Health and uptime | `http://192.168.4.1/api/v1/health` |
| Gateway metadata | `http://192.168.4.1/api/v1/gateway/info` |
| Available gateway services | `http://192.168.4.1/api/v1/services` |
| Connected station count | `http://192.168.4.1/api/v1/devices` |
| Discovery identity | `http://192.168.4.1/api/node` |

Expected behavior:
- The root and health endpoints return JSON.
- Health reports `ok: true` and `status: ready`.
- The gateway reports Wi-Fi AP, discovery, and health as available.
- Messaging is explicitly reported unavailable on the ESP.
- The station count increases when another phone/PC joins and decreases when it disconnects.
- The SSID remains available and health requests continue responding during a sustained test.

The protected `/api/v1/internal/status` endpoint should return HTTP 401 in a normal browser request. It is reserved for the future PC server and requires the configured identity/trust headers.

## Network values

- SSID: `BitVoid_Local` (configurable)
- Gateway IP: `192.168.4.1`
- HTTP port: `80`
- mDNS hostname: `esp-server.local` (use the IP if mDNS is unavailable)
- Maximum stations: `4` by default

The ESP does not route internet traffic. A successful Wi-Fi and health test does not mean BitVoid messaging is implemented yet.

## Troubleshooting

- **SSID does not appear:** check stable 3.3 V power, EN/CH_PD high, reset wiring, and Serial Monitor output.
- **Repeated resets:** use a regulator that can handle Wi-Fi transmit-current peaks and ensure a common ground.
- **Upload fails:** hold GPIO0 low while resetting, verify the COM port and board profile, then retry.
- **Wi-Fi connects but URL fails:** confirm the test device is connected to `BitVoid_Local`, temporarily disable mobile-data fallback, and browse to `http://192.168.4.1/api/v1/health`.
- **mDNS fails:** use the fixed IP `192.168.4.1`.

## Security

Use a unique WPA2 password and random 32+ character trust secret. Keep `config.h` private. The test API uses local HTTP and is not TLS-encrypted. Do not expose it to the public internet.
