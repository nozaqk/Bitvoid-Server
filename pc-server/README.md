# BitVoid PC Server

The PC server is a **backend service only**. It does not provide a browser messaging client or a web administration dashboard. The Android BitVoid app is the only user interface.

## Responsibilities

- Local BitVoid API and device pairing
- SQLite account, device, conversation and message persistence
- WebSocket messaging events
- Attachment upload and download APIs
- Authenticated PC-to-cloud synchronization
- Authenticated ESP-12E gateway health monitoring

## Run

Requires Node.js 22.13 or newer.

```powershell
npm install
npm run check
npm start
```

The server listens on `0.0.0.0:8787`. Android clients connect to the API at `http://bitvoid.local:8787` when mDNS is available, or to the PC's LAN IP on port 8787.

## ESP-12E network

1. Configure and flash the ESP-12E using `../esp12e-firmware/BitVoidESP12E`.
2. Connect the PC to the ESP access point (default SSID: `BitVoid_Local`).
3. Start this server.
4. Connect Android phones to the same Wi-Fi and open the BitVoid app.
5. Allow inbound TCP port 8787 through Windows Firewall on the private network.

The ESP is a Wi-Fi/discovery gateway; the PC hosts the local application API. The ESP does not run the BitVoid app or a website.

## Trust configuration

Configure `BITVOID_PC_SERVER_ID`, `BITVOID_PC_SERVER_SECRET`, `BITVOID_ESP_TRUST_SECRET`, `BITVOID_GATEWAY_ID`, and `BITVOID_CLOUD_SERVER_ID` in the private `.env` file. Use separate random 32+ character secrets for cloud and ESP trust. The cloud server must register the PC server ID and matching cloud secret.

The private `/admin/api/*` endpoints are backend management APIs only; no web dashboard is shipped or served. The ESP internal status endpoint is authenticated with the BVT-1 PC server identity and key.

No GitHub Actions workflows are used.
