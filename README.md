# BitVoid Server

BitVoid Server is the cross-platform, local-first application Server and native desktop administration suite for the BitVoid ecosystem on **Windows, Linux, and macOS**.

**No ESP8266, ESP-12E, ESP32, or microcontroller gateway is required. No browser dashboard or WebView is used. Local communication works completely offline without Internet access.**

---

## Architecture Overview

1. **Headless BitVoid Server Core (`src/`):**
   - Modular Node.js 22+ / Fastify 5 service backed by SQLite (WAL mode + versioned migrations).
   - Unified codebase supporting both **self-hosted** and **centrally hosted** deployments.
   - Every registered account is a **Node** supporting multiple registered **Devices** and revocable **Sessions**.
   - Full communication engine: Argon2id auth (with transparent legacy bcrypt migration), refresh-token rotation + reuse detection, direct & group messaging, channels, Live Classes with WebRTC signaling, streaming file attachments, durable offline/multi-device sync, and real-time WebSocket event fan-out with instant session/device revocation.
   - Three-mode networking: Direct computer Wi-Fi hotspot capability detection & OS adapters, Router/Ethernet LAN with mDNS, and Multi-site VPN/private-link profiles with TLS certificate pinning.
   - Protected local administration IPC (owner-only Unix socket `0600` by default; packaged Linux installs use a restricted `bitvoid-admin` group with socket `0660` and enrollment file `0640`; macOS remains owner-only; Windows uses a named pipe) with separate administrator accounts and single-use local first-run enrollment (zero default passwords).

2. **Native Desktop Administration Dashboard (`desktop/`):**
   - Native **C++17 + Qt 6 / QML** desktop application (no browser, no WebView, no Electron).
   - Manages Overview, Nodes & per-Node bandwidth, Devices & Sessions, Network & Hotspot, Logs & Audit Events, Security, Encrypted Backups & Database health, Configuration, and Software Updates.
   - Remains operational independently of the background service to inspect offline disk logs and start/stop/restart OS services (`Windows Service`, `systemd`, `launchd`).

3. **Administration, Migration & Backup CLIs (`bin/`):**
   - `npm run admin -- <command>` — Local IPC administration CLI.
   - `npm run migrate -- [status|up]` — Versioned SQLite migration status and execution.
   - `npm run backup -- [list|create|verify|restore]` — Consistent online WAL backup & restore CLI.

---

## Quick Start (Development / Source Run)

### Requirements
- Node.js **22 or newer** (npm included)
- For building the native desktop UI from source: CMake 3.21+, C++17 compiler, Qt 6.5+

### Setup & Run
```bash
cp .env.example .env
npm ci
```

Generate a strong unique `BITVOID_TOKEN_SECRET` (at least 32 characters) and place it in `.env`:
```bash
openssl rand -base64 48
```

Start the Server:
```bash
npm start
```

Verify health:
```bash
curl http://127.0.0.1:8787/api/v1/health
```

### Verification & Automated Test Suite
```bash
npm run check           # Syntax check across all JS modules
npm test                # Full unit, contract, integration, and security suite
npm run test:unit       # Passwords, migrations, crypto, validation, networking adapters
npm run test:contract   # Android API v1 compatibility contract
npm run test:integration# Auth/devices/sessions, WS revocation, messaging, channels, Live Classes, attachments/sync, backups, local IPC
npm run test:security   # Brute-force lockout, JWT tampering, SQLi safety, cross-Node isolation, log redaction
```

---

## Documentation

- [Authoritative Server API v1 Contract](docs/SERVER-API-V1.md)
- [Android Client Integration — Phase 3 Companion](docs/ANDROID-INTEGRATION.md)
- [Deployment & OS Service Guide](docs/DEPLOYMENT.md)
- [Native Desktop & Local IPC Architecture](docs/DESKTOP-ARCHITECTURE.md)
- [Three-Mode Networking Guide](docs/NETWORKING.md)
- [Security Architecture](docs/SECURITY.md)
- [Desktop App Build Instructions](desktop/README.md)

## Packaging & Releases

Cross-platform CI and versioned immutable releases (Windows `.exe` installer, Linux `.deb`, `.rpm`, and AppImage, macOS `.dmg` with SHA-256 checksums and SBOM) are automated in `.github/workflows/ci.yml` and `.github/workflows/release.yml`. Previous GitHub Releases are always retained.

## Related Repositories

- Server: https://github.com/nozaqk/Bitvoid-Server
- Android Client: https://github.com/nozaqk/BitVoid
