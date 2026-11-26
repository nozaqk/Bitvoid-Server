# BitVoid Server

BitVoid Server is a cross-platform application service that runs as software on Windows, Linux, or macOS. It does not require ESP8266, ESP-12E, Arduino IDE, or dedicated Gateway hardware.

The Android BitVoid app connects directly to this Server over the same private Wi-Fi network or LAN. The computer can be a desktop or laptop. The Server does not create a Wi-Fi network; use an existing router, hotspot, or LAN. Internet access is not required.

## Architecture

- Android app: only user-facing client.
- BitVoid Server: account authentication, local data, and authenticated real-time connection.
- Network: existing private Wi-Fi/LAN.
- Database: local SQLite file on the host computer.
- ESP8266/Gateway firmware: removed from this repository; not required.

## Requirements

- Node.js 20 or newer and npm.
- Windows 10/11, current Linux, or macOS.
- Phone and Server computer on the same private network.

## Windows quick start

1. Install Node.js 20 LTS or newer from https://nodejs.org/.
2. Download and extract this repository ZIP.
3. Open PowerShell in the Bitvoid-Server folder.
4. Run: npm install
5. Copy .env.example to .env.
6. Generate a secret: in PowerShell run $secret = [Convert]::ToBase64String([Security.Cryptography.RandomNumberGenerator]::GetBytes(48)).
7. Put that generated value in BITVOID_TOKEN_SECRET inside .env. Keep .env private.
8. Run: npm start

The Server listens on port 8787 and creates data/bitvoid.sqlite automatically.

## Linux / macOS

Copy .env.example to .env, set BITVOID_TOKEN_SECRET to the output of openssl rand -base64 48, then run npm install and npm start.

## Connect your phone

1. Connect the phone and host computer to the same private Wi-Fi/LAN.
2. Find the computer's LAN IPv4 address: ipconfig on Windows, ip addr on Linux, or ipconfig getifaddr en0 on macOS.
3. Allow inbound TCP port 8787 through the computer firewall on the private network only.
4. Test from the phone: http://HOST-LAN-IP:8787/api/v1/health
5. Configure the Android app to use http://HOST-LAN-IP:8787 until automatic LAN discovery is integrated.

The Server binds to 0.0.0.0 by default. Do not assume 192.168.4.1 is the Server; use the computer's actual LAN address.

## Implemented API

- GET /api/v1/health — health/readiness.
- GET /api/v1/server/info — stable Server identity.
- POST /api/v1/account/register — create account, session, one-time recovery key.
- POST /api/v1/account/login — authenticate.
- POST /api/v1/account/recover — reset password using recovery key.
- GET /api/v1/me — authenticated account.
- POST /api/v1/auth/revoke — revoke current session.
- WS /api/v1/events — authenticated WebSocket handshake and heartbeat.

The account endpoints match the Android app's current BitVoidAccountAuth request/response contract. Usernames are 2-24 characters and passwords are 10-128 characters. Passwords and recovery keys are bcrypt-hashed. The recovery key is returned only at registration; save it securely.

## Security

- Keep the computer on a trusted private network. Do not port-forward port 8787 to the public internet.
- Use a unique BITVOID_TOKEN_SECRET and keep .env private.
- Account passwords and recovery keys are bcrypt-hashed. Session tokens are revocable and stored hashed in SQLite.
- Account endpoints are rate-limited.
- Default HTTP/WS traffic is not encrypted and is intended only for a trusted private LAN. Configure TLS before using an untrusted network. The Android app must separately validate/trust the TLS certificate before using HTTPS/WSS.
- TLS protects transport between the app and Server; it is not end-to-end encryption between users.
- Hidden SSIDs and MAC allowlists are not substitutes for WPA2/WPA3 and application authentication.

## Configuration

- BITVOID_HOST: default 0.0.0.0.
- BITVOID_PORT: default 8787.
- BITVOID_DISPLAY_NAME: default BitVoid Local Server.
- BITVOID_DATABASE_PATH: default ./data/bitvoid.sqlite.
- BITVOID_TOKEN_SECRET: required random secret, at least 32 characters.
- BITVOID_TOKEN_TTL: default 7d.
- BITVOID_TLS_CERT and BITVOID_TLS_KEY: optional TLS certificate/key paths.

## Current scope

This is the initial portable Server foundation. Conversations, messages, channels, Live Classes, attachment transfer, durable offline synchronization, and full event fan-out are not implemented yet and must not be presented as available features.
