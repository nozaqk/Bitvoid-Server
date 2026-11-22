# BitVoid standalone server architecture

- ESP-12E: Wi-Fi SoftAP, DHCP through ESP8266 core, gateway identity, health/discovery API and a separate protected gateway dashboard.
- PC: Node.js application API, device pairing, users, SQLite persistence, conversations, messages, WebSocket delivery and a separate protected PC administrator dashboard.
- Android/desktop clients: connect to the PC application service at `http://bitvoid.local:8787` when mDNS is available.

## Local names and dashboard boundaries

| Component | Local URL | Responsibility |
|---|---|---|
| Main BitVoid service | `http://bitvoid.local:8787` | Client-facing API and WebSocket service |
| PC administration | `http://pc-server.local:8787/admin` | PC application server operations and user/device monitoring |
| ESP gateway administration | `http://esp-server.local/admin` | ESP-12E Wi-Fi gateway diagnostics and settings |

The PC server advertises `bitvoid.local` and `pc-server.local` using Bonjour/mDNS. It also polls the ESP protected `/admin/api/status` endpoint every 10 seconds using credentials in its local `.env`; the PC dashboard reports online/offline state and returned hardware/network telemetry. The ESP8266 firmware advertises `esp-server.local`. The names are independent hostnames, not path aliases. The PC dashboard uses the PC server's own administrator account; the ESP dashboard uses separate credentials stored in the local, untracked firmware `config.h`.

mDNS requires clients to support multicast DNS and be on the same local network. If name resolution is unavailable, the ESP AP is reachable at `192.168.4.1`, and the PC server prints its current LAN IP fallback at startup.

The ESP is not an application proxy. Clients and PC are peers on the same local subnet. ESP SoftAP defaults to 192.168.4.1/24. The PC receives a different DHCP address; the main service hostname is advertised by the PC process.

The PC API is a new standalone API using the BitVoid Gateway API v1 metadata contract. It is not yet a drop-in implementation of every endpoint in the existing Android-hosted server. Full Android compatibility requires adapters and end-to-end testing.

Security boundaries: WPA2 protects Wi-Fi admission; device bearer tokens authorize application requests; PC and ESP dashboards each require their own administrator credentials. Initial pairing approval uses a terminal-generated admin code and is a development bootstrap, not cryptographic public-key or physical-presence pairing. HTTP/WS and ESP HTTP Basic Authentication are unencrypted on the isolated LAN. Do not expose this service to untrusted networks or the public internet.
