# BitVoid ESP-12E firmware (Arduino IDE)

This sketch turns an ESP-12E / ESP8266 into a small WPA2 Wi-Fi access point and exposes BitVoid Universal Gateway API v1 discovery and health endpoints. The PC runs the actual application server.

## Arduino IDE setup

1. Install Arduino IDE 2.x.
2. In File → Preferences, add Boards Manager URL: https://arduino.esp8266.com/stable/package_esp8266com_index.json
3. Open Boards Manager and install **esp8266 by ESP8266 Community**.
4. Install **ArduinoJson 6.x** using Library Manager.
5. Copy `BitVoidESP12E/config.example.h` to `BitVoidESP12E/config.h`.
6. Change SSID, WPA2 password (8-63 characters), unique gateway ID and display name.
7. Open `BitVoidESP12E/BitVoidESP12E.ino`, select the matching ESP8266 board profile (often Generic ESP8266 Module), flash size and serial port.
8. Upload and open Serial Monitor at 115200 baud.

## Connect

- ESP access point: configured SSID
- ESP gateway IP: `192.168.4.1`
- Gateway info: `http://192.168.4.1/api/v1/gateway/info`
- Health: `http://192.168.4.1/api/v1/health`

Connect the PC to this SSID, start `pc-server/`, then use the PC Wi-Fi IP printed by the server (not 192.168.4.1) on Android clients.

## Hardware

Use a stable regulated 3.3 V supply with sufficient current for Wi-Fi transmit peaks. Use 3.3 V UART logic; never connect 5 V serial logic directly to ESP8266 RX. Ensure ESP8266 boot-strap pins GPIO0, GPIO2 and GPIO15 are in valid states. Default SoftAP capacity is four stations. The ESP does not bridge this network to the internet.

## Scope

Implements `/api/v1/gateway/info`, `/api/v1/health`, `/api/v1/services`, `/api/v1/devices` and legacy `/api/node`. It does not implement pairing, messaging, file storage, media or WebRTC.
