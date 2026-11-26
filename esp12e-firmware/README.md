# BitVoid ESP-12E Gateway

The ESP-12E is a **headless local Wi-Fi access point and discovery/health gateway**. The Android app remains the only user interface. The ESP does not host messaging, pairing, channels, live classes, a dashboard, or a captive portal; those application services belong on the PC server.

## Hardware requirements

- ESP-12E / ESP8266 module
- Stable regulated 3.3 V supply capable of handling Wi-Fi transmit-current peaks (use a suitable regulator; do not power the module from a weak USB-to-serial 3.3 V pin)
- Common ground between ESP and USB-to-serial adapter
- 3.3 V UART logic; never connect 5 V UART TX directly to ESP RX
- USB-to-serial adapter with adequate current capacity

For a typical ESP-12E upload: connect adapter TX to ESP RX, adapter RX to ESP TX, GND to GND, 3.3 V to a suitable supply, GPIO0 to GND during reset/upload, and release GPIO0 from GND for normal boot. Keep EN/CH_PD high and use the board's required boot-strapping levels. Disconnect/reconnect power after upload if needed.

## Arduino IDE setup

1. Install Arduino IDE 2.x.
2. In Preferences, add this Boards Manager URL: `https://arduino.esp8266.com/stable/package_esp8266com_index.json`.
3. In Boards Manager, install **esp8266 by ESP8266 Community**.
4. Install **ArduinoJson 6.x** using Library Manager.
5. Open `BitVoidESP12E/BitVoidESP12E.ino`.
6. Copy `BitVoidESP12E/config.example.h` to `BitVoidESP12E/config.h` in the same folder.
7. Edit `config.h`: choose a private WPA2 password (8–63 characters) and replace the ESP trust secret with a unique random value of at least 32 characters. Keep the configured gateway and PC server IDs consistent with the PC server's `.env`.
8. Select **Generic ESP8266 Module** (or the matching ESP-12E profile), select the correct COM port, and upload.
9. Open Serial Monitor at **115200 baud** and press RESET.

Do not commit `config.h` or share its secrets. The committed example intentionally contains placeholders and will stop at startup until configured.

## First hardware test

After a successful upload, Serial Monitor should print `GATEWAY READY`, the SSID, and `http://192.168.4.1`.

1. On a phone or PC, join the configured `BitVoid_Local` Wi-Fi network using the password from your private `config.h`.
2. Open these URLs in a browser on the connected device:
   - `http://192.168.4.1/` — gateway identity and role
   - `http://192.168.4.1/api/v1/health` — health, uptime, connected client count, free heap
   - `http://192.168.4.1/api/v1/gateway/info` — gateway capabilities
   - `http://192.168.4.1/api/v1/services` — available gateway services
   - `http://192.168.4.1/api/v1/devices` — connected station count
   - `http://192.168.4.1/api/node` — discovery identity
3. Confirm that the client count increases when a second device joins and falls when it disconnects.
4. Keep the phone and PC connected to this same Wi-Fi for later Android-to-PC testing.

The ESP's internal telemetry endpoint `/api/v1/internal/status` is intentionally protected. It requires both `X-BitVoid-Server-Id` and `X-BitVoid-Server-Key` headers matching the PC server's private configuration. A normal browser request should receive HTTP 401.

## Network/API contract

- SSID: `BitVoid_Local` (configurable)
- Gateway IP: `192.168.4.1`
- HTTP port: `80`
- mDNS: `esp-server.local` (fallback to the IP address)
- Default maximum stations: `4`
- PC BitVoid application API: separate PC host on TCP `8787`

The ESP does not route internet traffic and does not relay PC application traffic. It provides the local Wi-Fi network only. Connect the PC running `pc-server` and Android devices to the ESP access point. The PC hosts the application API on port 8787.

## Troubleshooting

- **SSID does not appear:** check stable 3.3 V power, EN/CH_PD high, reset wiring, and Serial Monitor output.
- **Repeated resets / brownout-like behavior:** replace weak USB-serial 3.3 V power with a suitable regulated supply and common ground.
- **Upload fails:** hold GPIO0 low while resetting, confirm the correct COM port and board profile, then release GPIO0 after upload.
- **Wi-Fi connects but URL fails:** confirm the device is connected to `BitVoid_Local`, disable mobile-data fallback temporarily, and browse to `http://192.168.4.1/api/v1/health`.
- **PC cannot be reached from phone:** both must be on the same ESP AP; the PC server, not the ESP, must listen on `0.0.0.0:8787`. Allow TCP 8787 on the PC's Private firewall profile.

## Security

Use a unique WPA2 password and unique random 32+ character ESP trust secret. Keep `config.h` private. The trust check is a shared-secret identity check on the trusted local Wi-Fi network, not TLS encryption. Do not expose this gateway or the PC server directly to the public internet.
