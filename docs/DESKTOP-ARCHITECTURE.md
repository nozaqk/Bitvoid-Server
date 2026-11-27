# Desktop Application & Local Administration IPC Architecture

## 1. Cross-Platform Technology Decision

**Approved Technology:** **Native C++17 + Qt 6 / QML (`Qt6::Quick`, `Qt6::QuickControls2`, `Qt6::Network`, `Qt6::Widgets`)** built with CMake (`desktop/`).

### Rationale
- **Strict compliance with approved architecture:** No browser dashboard, no WebView, no Electron/Chromium runtime, no remotely served admin web pages.
- **Native OS IPC out of the box:** `QLocalSocket` natively supports Unix domain sockets on Linux/macOS and Named Pipes (`\\.\pipe\bitvoid-server-admin`) on Windows from one C++ codebase.
- **Independent failure diagnostics:** `ServiceController` queries OS service managers (`sc.exe`, `systemctl`, `launchctl`) and reads disk logs directly even when the background Server service is stopped or failed.
- **Background service independence:** Closing the desktop dashboard window never stops the background Server service; administrators must explicitly choose **Stop** or invoke `service.shutdown`.

## 2. Protected Local IPC Protocol (JSON-RPC 2.0)

- **Transport:** Newline-delimited JSON frames (`\n`) over:
  - Linux/macOS: Unix domain socket (`<dataDir>/bitvoid-admin.sock`, permissions `0600`).
  - Windows: Named Pipe (`\\.\pipe\bitvoid-server-admin`).
- **Authentication:**
  - Unauthenticated bootstrap methods (local IPC only): `admin.status`, `admin.setup`, `admin.login`.
  - All management methods require `authToken` signed with the domain-separated HKDF admin JWT key and backed by an active `admin_sessions` row. Regular Node JWTs are strictly rejected.

### Implemented IPC Methods
- **Lifecycle & Bootstrap:** `admin.status`, `admin.setup`, `admin.login`, `admin.logout`, `service.status`, `service.shutdown`
- **Overview & Metrics:** `overview.get`, `metrics.snapshot`, `metrics.nodeTraffic`
- **Nodes:** `nodes.list`, `nodes.get`, `nodes.setStatus`
- **Devices & Sessions:** `devices.list`, `devices.revoke`, `sessions.list`, `sessions.revoke`, `sessions.cleanup`
- **Networking:** `network.overview`, `network.hotspot.capability`, `network.hotspot.start`, `network.hotspot.stop`, `network.vpn.list`, `network.vpn.create`, `network.vpn.delete`, `network.trustBootstrap`
- **Logs & Audit:** `logs.query`, `audit.query`
- **Security:** `security.overview`, `security.revokeAdminSession`
- **Backups & Database:** `backups.list`, `backups.create`, `backups.verify`, `backups.prune`, `database.status`, `database.integrityCheck`
- **Configuration & Updates:** `config.get`, `config.setEncrypted`, `config.deleteEncrypted`, `updates.status`, `updates.loadManifest`, `updates.verifyArtifact`

## 3. Headless CLI Companion (`bin/bitvoid-admin.js`)

For headless Linux servers or automated operations, `bin/bitvoid-admin.js` speaks the exact same local IPC protocol over Unix socket / Named Pipe.
