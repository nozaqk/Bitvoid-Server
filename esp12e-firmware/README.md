# BitVoid ESP-12E Gateway

The ESP-12E firmware is a **headless Wi-Fi and discovery gateway**. It does not host a website, dashboard, browser client, account system, or messaging interface. Use the Android BitVoid app as the only user interface.

## Arduino IDE setup

1. Install Arduino IDE 2.x.
2. Add the ESP8266 Boards Manager URL: `https://arduino.esp8266.com/stable/package_esp8266com_index.json`.
3. Install **esp8266 by ESP8266 Community** and **ArduinoJson 6.x**.
4. Copy `BitVoidESP12E/config.example.h` to a local `config.h` (never commit it).
5. Set a unique WPA2 SSID/password, gateway ID, PC server ID, and ESP trust secret.
6. Select the ESP-12E/ESP8266 board profile and upload the sketch.

## Gateway endpoints

- Access point address: `192.168.4.1`
- Discovery: `/api/node`
- Gateway metadata: `/api/v1/gateway/info`
- Health: `/api/v1/health`
- Device count: `/api/v1/devices`
- PC-authenticated internal status: `/api/v1/internal/status`

The internal status endpoint requires the configured PC server ID and BVT-1 trust key. No browser-based management page is provided.

## Network setup

1. Connect the PC running `pc-server` to the ESP Wi-Fi.
2. Start the PC server.
3. Connect Android phones to the same ESP Wi-Fi.
4. Open the BitVoid Android app. The app discovers the PC API server on port 8787.

The ESP does not bridge the Wi-Fi network to the internet. The PC server provides the application API and local data persistence.

## Hardware and security

Use a regulated 3.3 V supply with enough current for Wi-Fi transmit peaks. Use 3.3 V UART logic; never connect 5 V serial logic directly to ESP8266 RX. Keep `config.h` private. Use a unique WPA2 password and a random 32+ character ESP trust secret.
