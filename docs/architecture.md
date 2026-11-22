# BitVoid standalone server architecture

- ESP-12E: Wi-Fi SoftAP, DHCP through ESP8266 core, gateway identity, health and discovery API.
- PC: Node.js application API, device pairing, users, SQLite persistence, conversations, messages and WebSocket delivery.
- Android/desktop clients: connect directly to the PC's Wi-Fi address on TCP port 8787.

The ESP is not an application proxy. Clients and PC are peers on the same local subnet. ESP SoftAP defaults to 192.168.4.1/24. The PC receives a different DHCP address; discover it from the PC server startup output rather than hardcoding an address.

The PC API is a new standalone API using the BitVoid Gateway API v1 metadata contract. It is not yet a drop-in implementation of every endpoint in the existing Android-hosted server. Full Android compatibility requires adapters and end-to-end testing.

Security boundaries: WPA2 protects Wi-Fi admission; device bearer tokens authorize application requests. Initial pairing approval uses a terminal-generated admin code and is a development bootstrap, not cryptographic public-key or physical-presence pairing. HTTP/WS are unencrypted on the isolated LAN. Do not expose this service to untrusted networks or the public internet.
