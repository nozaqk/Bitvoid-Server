# AirMesh Phase 1 — Architecture Audit and Implementation Specification

**Audit date:** 2026-11-27  
**Scope:** `nozaqk/Bitvoid-Server` and `nozaqk/BitVoid`, both default branches (`main`)  
**Change type:** Documentation only. No application source, schema, runtime, or release workflow was changed in this phase.

## 1. Executive decision

The repositories contain a useful starting point, but they do not yet implement the approved AirMesh product architecture.

The Server repository currently contains a small Node.js/Fastify service with SQLite-backed username/password accounts, recovery keys, revocable bearer sessions, health/identity endpoints, mDNS advertisement, and a minimal authenticated WebSocket heartbeat. It is not yet a desktop application, an operating-system background service, a dashboard, a hotspot manager, or a complete messaging server.

The Android repository contains the native Jetpack Compose client and substantial legacy/local networking code. It has an account-authentication client that matches the Server's register/login/recover endpoints, but the separate messaging/local-client flow still uses an older device-pairing API and endpoints that the current Server does not implement. The Android repository also still contains an embedded HTTP/WebSocket server and foreground service. These must be migrated carefully before the Android app can become a pure end-user client.

**Recommended next implementation phase:** stabilize the Server core, define one authoritative API contract, add database migrations and automated tests, and reconcile Android authentication/session handling with the actual Server API before building the desktop dashboard.

The approved product boundary remains:

- The **AirMesh Server desktop application** owns the Server process, background service, configuration, storage, security, backups, updates, and all server-wide administration.
- The desktop application contains a **native embedded dashboard**. It is not a website, browser dashboard, remotely served web page, or Android administration screen.
- The Android app is the end-user communication client. It must not administer the whole Server.
- The same Server core supports **self-hosted** and **centrally hosted** deployments.
- Network operation supports a computer-hosted Wi-Fi hotspot when the OS and adapter allow it, an existing router/Ethernet LAN, and secure inter-site connectivity over VPN/private links.
- Local communication does not require Internet access. Connecting geographically separate locations requires a private inter-site path; it cannot be achieved by local Wi-Fi discovery alone.
- GitHub Actions builds, tests, packages, verifies, and publishes versioned desktop releases. Old releases must be retained.

## 2. Repository snapshot

### 2.1 AirMesh Server

- Repository: https://github.com/nozaqk/Bitvoid-Server
- Default branch: `main`
- Audited head: [`6b85189f57fe160f9a544e5c8cd856bfdac9fe5b`](https://github.com/nozaqk/Bitvoid-Server/commit/6b85189f57fe160f9a544e5c8cd856bfdac9fe5b)
- Latest inspected source commit before the README-only head: [`9ab0b38909f21786c2a770b6d011bebade517901`](https://github.com/nozaqk/Bitvoid-Server/commit/9ab0b38909f21786c2a770b6d011bebade517901)
- No open pull requests were returned by the repository's open-PR query at audit time.
- PR [#19 — cross-platform Server foundation](https://github.com/nozaqk/Bitvoid-Server/pull/19) is merged.
- Recent history also includes the removal of the ESP-12E firmware and the addition of mDNS discovery and the current portable Server README.

Inspected files:

- `README.md`
- `package.json`
- `.env.example`
- `.gitignore`
- `src/server.js`
- `docs/SERVER-API-V1.md`
- `docs/DEPLOYMENT.md`

### 2.2 Android application

- Repository: https://github.com/nozaqk/BitVoid
- Default branch: `main`
- Audited head: [`7f2aa122166991bef1d4ae69be4456cb9abc0ced`](https://github.com/nozaqk/BitVoid/commit/7f2aa122166991bef1d4ae69be4456cb9abc0ced)
- No open pull requests were returned by the repository's open-PR query at audit time.
- PR [#68 — remove the ESP Gateway requirement](https://github.com/nozaqk/BitVoid/pull/68) is merged.
- PR [#67 — automatic local discovery retry](https://github.com/nozaqk/BitVoid/pull/67) is merged.
- PR [#65 — Server API v1 contract and Android transport](https://github.com/nozaqk/BitVoid/pull/65) is merged.
- PR [#63 — local-first Android app foundation](https://github.com/nozaqk/BitVoid/pull/63) records 53 unit tests and a debug APK build as passing at that earlier commit. Later PRs #67 and #68 explicitly state that Android build, unit tests, and physical LAN testing were not run for those changes.

Inspected files:

- `README.md`
- `settings.gradle.kts`
- `build.gradle.kts`
- `gradle/libs.versions.toml`
- `app/build.gradle.kts`
- `app/src/main/AndroidManifest.xml`
- `app/src/main/java/com/bitvoid/network/auth/BitVoidAccountAuth.kt`
- `app/src/main/java/com/bitvoid/network/backend/BitVoidLocalDiscovery.kt`
- `app/src/main/java/com/bitvoid/network/backend/BitVoidBackendConnectionManager.kt`
- `app/src/main/java/com/bitvoid/network/local/BitVoidLocalApi.kt`
- `app/src/main/java/com/bitvoid/network/local/BitVoidLocalViewModel.kt`
- `app/src/main/java/com/bitvoid/network/local/BitVoidLocalCredentials.kt`
- `app/src/main/java/com/bitvoid/network/local/BitVoidLocalStore.kt`
- `app/src/main/java/com/bitvoid/network/ui/BitVoidViewModel.kt`
- `app/src/main/java/com/bitvoid/network/server/BitVoidLocalServer.kt`
- `app/src/main/java/com/bitvoid/network/service/BitVoidForegroundService.kt`
- `.github/workflows/release.yml`
- `docs/SERVER-API-V1.md`

## 3. Current Server implementation audit

### 3.1 What exists

The current Server is a single-file Node.js application in `src/server.js`:

- Fastify HTTP server, Helmet, rate limiting, and WebSocket plugin.
- SQLite through `better-sqlite3`, with WAL mode and foreign keys enabled.
- `settings`, `accounts`, and `sessions` tables created inline at startup.
- Stable server ID stored in the settings table.
- `GET /api/v1/health` and `GET /api/v1/server/info`.
- `POST /api/v1/account/register`, `POST /api/v1/account/login`, and `POST /api/v1/account/recover`.
- `GET /api/v1/me` and `POST /api/v1/auth/revoke`.
- Authenticated `/api/v1/events` WebSocket handshake with a connected message and ping/pong only.
- Bonjour/mDNS advertisement on the HTTP service type.
- Optional TLS certificate and private-key file configuration.
- Default listen port 8787 and default bind address 0.0.0.0.

Current package dependencies include Fastify 5, `better-sqlite3`, `bcryptjs`, JWT, dotenv, Fastify security/rate-limit/WebSocket plugins, and `bonjour-service`. `package.json` declares Node.js 20 or newer.

### 3.2 Current data model

The database currently has only:

| Table | Current purpose | Important limitation |
|---|---|---|
| `settings` | Key/value settings, including stable server ID | No typed settings, audit history, or encryption |
| `accounts` | ID, unique case-insensitive username, password hash, recovery hash, creation time | No display name, explicit Node model, status, profile, or per-Node metrics |
| `sessions` | Session ID, account ID, token hash, creation/expiry/revocation times | No device table, device metadata, session listing UI, or socket lifecycle |

For the approved product, one registered account is one **Node**. Keep the existing account ID stable and treat it as the initial Node ID; do not discard or rename existing account records merely to change terminology. Add device/session entities separately. One Node may own multiple devices and multiple active sessions.

### 3.3 Implemented endpoints versus product requirements

| Area | Current state |
|---|---|
| Health and Server identity | Implemented |
| Username/password registration and login | Implemented in the Server |
| 44-character hex recovery key | Generated once at registration; only a SHA-256 digest is stored |
| Password change | Not implemented |
| Device enrollment and device inventory | Not implemented in the current Server |
| Node inventory/status administration | Not implemented |
| Direct/group conversations | Not implemented in the current Server |
| Messages/history/receipts | Not implemented |
| Channels | Not implemented |
| Live Classes/signaling | Not implemented |
| File/attachment storage | Not implemented |
| Durable offline synchronization | Not implemented |
| Presence and event fan-out | Not implemented; WebSocket is only a connection/heartbeat foundation |
| Server-wide desktop administration | Not implemented |
| Background service and automatic startup | Not implemented |
| Hotspot management | Not implemented; current README explicitly says the Server does not create a hotspot |
| Central-hosting/VPN configuration | Not implemented |
| Installers and update mechanism | Not implemented |

The current Server API documentation accurately describes most of these as planned rather than working. A successful health response must not be presented as proof that chat, channels, Live Classes, or file transfer are ready.

### 3.4 Important implementation limitations

1. `src/server.js` combines configuration, database setup, migrations-by-side-effect, authentication, routes, WebSocket handling, and startup/shutdown in one file. It should be separated into testable modules before feature expansion.
2. Schema creation uses inline `CREATE TABLE IF NOT EXISTS`; there is no migration version table or explicit migration runner.
3. `package.json` has only `start`, `dev`, and `check`. The `check` script only runs `node --check src/server.js`; it is not a test suite and does not test runtime behavior or every future module.
4. No Server test suite or Server release workflow was surfaced by the default-branch searches in this audit. Confirm the full repository tree during Phase 2.
5. No `package-lock.json` was present at the inspected default-branch path. A committed lockfile is needed for reproducible CI and releases.
6. The current run instructions require the user to install Node.js, run npm, configure `.env`, and keep a terminal open. This is not the approved end-user installation experience.
7. The current README says the Server does not create a hotspot and expects an existing network. Hotspot support remains a separate OS-integration feature.
8. The previous merged Server PRs #2 and #3 introduced browser-hosted admin pages in an earlier architecture iteration. The current `src/server.js` does not register an `/admin` dashboard, and the current README lists complete administration as unfinished. Do not restore the old browser dashboard; the approved replacement is a native desktop dashboard embedded in the installed Server application.

## 4. Security audit and required controls

### 4.1 Existing positive controls

- Passwords are not stored as readable text; the Server stores bcrypt hashes using cost 12.
- Password input is currently limited to 72 UTF-8 bytes because bcrypt truncates longer input.
- Registration creates a random 22-byte (176-bit) hexadecimal recovery value; only its SHA-256 digest is stored.
- Session tokens are signed and their SHA-256 digests are stored in SQLite.
- JWT verification checks issuer and audience, and the session row is checked for revocation.
- Registration, login, and recovery have route-specific rate limits.
- The Server does not trust forwarded proxy headers by default.
- The Android account client stores account credentials using Android Keystore-backed AES-GCM encryption.

### 4.2 Gaps to close before production

**Transport security**

- Network HTTP/WS is the default. The Server's TLS configuration is optional, and the Android manifest currently sets `android:usesCleartextTraffic="true"`.
- Do not ship a trust-all TLS client or rely on a hidden SSID/private subnet as the security boundary.
- Require TLS for remote/VPN and centrally hosted connections. For local first-run pairing, define a safe certificate bootstrap flow (for example, verify a short fingerprint/QR shown by the desktop dashboard and pin the Server identity).
- Keep loopback/IPC management traffic local to the host. Never expose the desktop administration API to the public LAN or Internet.

**Authentication and sessions**

- Plan a migration from bcrypt to Argon2id for new password hashes, with a versioned hash format and transparent rehash after successful login. Existing bcrypt hashes must continue to verify during migration; never ask users to reset passwords solely because the algorithm changes.
- Keep the recovery key high entropy and one-time display. Support deliberate recovery-key rotation and revoke all sessions on recovery.
- Add a device table and associate sessions with device IDs. The dashboard must distinguish Nodes, devices, and sessions.
- Enforce session expiry from both the signed token and database record; add cleanup of expired/revoked rows.
- Track active WebSockets and close them when a session is revoked or expires. Current WebSocket authentication happens only at connection time.
- Add rate limits and abuse controls that work across multiple client IPs, not only per-IP limits.

**Server administration**

- Server administrator credentials must be separate from Node account credentials.
- Never ship one shared default administrator password. Use a first-run setup flow with a one-time local enrollment code or OS-user authorization, then require the administrator to set a unique password or enroll a local OS identity.
- Remote dashboard administration should be allowed only over a trusted VPN/private link with strong authentication (preferably mTLS plus an administrator session).
- Add auditable administrator actions and role separation if multiple administrators are later supported.

**Data and operational security**

- Keep passwords, recovery values, bearer tokens, private keys, and message contents out of logs.
- Configure structured log redaction, bounded log rotation, and an administrator audit log.
- Protect the database and backups with OS file permissions; evaluate database encryption/key management for deployments where disk theft is in scope.
- Add SQLite integrity checks and a tested backup/restore workflow. A backup must be restorable, not merely downloadable.
- Add secret rotation and recovery procedures for the Server signing key. Do not silently regenerate it on restart.

**Username privacy decision**

The dashboard must be able to identify and manage Nodes. A plain username lookup is currently stored in SQLite. If the product later requires username confidentiality at rest, use a keyed lookup index plus encrypted profile fields and define key recovery carefully. Do not claim usernames are hidden from the Server while also promising that the Server dashboard can display them. Passwords, by contrast, must never be recoverable by the Server.

## 5. Android compatibility audit

The Android repository currently has two overlapping authentication/network paths:

1. `BitVoidAccountAuth` in `app/src/main/java/com/bitvoid/network/auth/BitVoidAccountAuth.kt` calls the Server's current `/api/v1/account/register`, `/login`, and `/recover` endpoints and stores the returned account token in Keystore-backed preferences. `BitVoidViewModel` invokes this flow for create-account, login, and recovery.
2. `BitVoidLocalApi` and `BitVoidLocalViewModel` still use the older device-pairing path and separate `BitVoidLocalCredentials` storage. They call `/api/v1/pairing/request`, `/api/v1/users/register`, conversations, and message endpoints that the current Server does not implement.

This means the app has an account-authentication client, but the account token and the local messaging/device token are not yet one coherent session lifecycle.

### 5.1 Concrete contract mismatches

| Android expectation | Current Server | Required action |
|---|---|---|
| `POST /api/v1/account/register` | Implemented | Keep as canonical account creation route |
| `POST /api/v1/account/login` | Implemented | Keep as canonical login route |
| `POST /api/v1/account/recover` | Implemented | Keep and add recovery-key rotation/session revocation tests |
| `POST /api/v1/pairing/request` | Not implemented | Replace the old mandatory pairing flow with account login plus explicit device enrollment |
| `POST /api/v1/users/register` | Not implemented | Remove the duplicate profile-creation path or define a single Node profile endpoint |
| `GET /api/v1/me` | Returns `data.account` in a metadata envelope | Align Android parsing; current local profile parser expects `user`, `profile`, or root-level fields |
| Conversations/messages/channels/Live Classes/sync | Not implemented | Implement incrementally from one shared contract |
| WebSocket events | Only authenticated connect and ping/pong | Add authenticated subscriptions, durable event IDs, event fan-out, and sync recovery |

The Android `docs/SERVER-API-V1.md` still describes pairing endpoints and an API surface that is not the same as the current Server's account-auth API. The Server repository has a separate API document. There must be one authoritative contract, referenced from both repositories, and generated/contract-tested against both implementations.

### 5.2 Discovery and hosting compatibility

- Android defaults to `http://bitvoid.local:8787`.
- The Android README describes `bitvoid-server.local` and `_bitvoid-server._tcp`.
- The Android discovery implementation resolves `bitvoid.local` and scans `_http._tcp.`.
- The Server currently advertises a Bonjour HTTP service named `AirMesh Server`; its Server API document describes the custom `_bitvoid-server._tcp` service and `bitvoid-server.local` hostname.
- Standardize the service type, instance naming, hostname, TXT identity fields, and fallback rules. mDNS discovery is link-local and should not be expected to cross routers or VPN sites.
- Android's current URL allowlist accepts a narrow set of private IPv4 addresses and `bitvoid.local`. It does not support arbitrary trusted VPN DNS names, IPv6 ULA, or common overlay-VPN address ranges. Replace the raw private-IP-only rule with explicit trusted Server profiles that verify the Server ID and TLS identity. Do not simply allow every public host.
- `BitVoidBackendConnectionManager` currently selects the local Server or offline; its CLOUD enum/config fields are retained but cloud hosting is not selected. Add a deliberate self-hosted/central-host profile model rather than silently falling back to an Internet endpoint.

### 5.3 Android-as-client migration

The Android repository still contains `BitVoidLocalServer` (NanoWSD, port 8080) and `BitVoidForegroundService` code that can start an embedded local HTTP server. This is legacy behavior that conflicts with the approved desktop Server being the authority. Do not delete it blindly: first map every endpoint, data store, notification, media, and signaling responsibility to the desktop Server; migrate existing user data where necessary; then disable/remove the embedded Server and keep only client-side background work that Android legitimately needs (notifications, upload/download, reconnect, and call handling).

The Android manifest currently allows cleartext traffic application-wide. Keep any temporary development-only local HTTP exception narrowly scoped, then require validated HTTPS/WSS for production and remote profiles.

## 6. Approved target architecture

### 6.1 Product components

**A. AirMesh Server Service**

- One core service for all deployment types.
- Runs headlessly and starts at operating-system boot.
- Keeps running when the desktop dashboard window closes.
- Owns API, authentication, database, media storage, WebSocket sessions, discovery, metrics, and scheduled maintenance.
- Exposes a versioned app API to Android and a separate management API over local IPC.
- Can run on a local PC, a dedicated on-premises machine, or a central VPS/cloud VM.

**B. AirMesh Server Desktop Application**

- Native cross-platform Windows, Linux, and macOS application.
- Recommended UI direction: Qt 6/QML for a native desktop interface without a browser-hosted dashboard or Android WebView.
- Contains the embedded dashboard and first-run setup.
- Connects to the local service over a protected local IPC channel (Windows named pipe; Unix-domain socket on Linux/macOS).
- For remote central administration, connects only through a configured VPN/private link and a separately authenticated management channel.
- Closing the window hides/exits the dashboard process but does not stop the service. A clear Stop Server action is required.

**C. AirMesh Android Application**

- Native Jetpack Compose end-user client.
- Handles account access, Node identity, devices, direct/group messaging, channels, Live Classes, media, notifications, local cache/outbox, discovery, and reconnection.
- Does not expose server-wide settings, Node administration, service controls, backups, or server update controls.

### 6.2 Background service lifecycle

Use native OS service managers:

| Platform | Service manager | Desktop application |
|---|---|---|
| Windows | Windows Service | Signed `.exe` installer and dashboard |
| Linux | systemd service | `.deb` package; AppImage as a portable dashboard/client launcher where service installation is not available |
| macOS | launchd daemon/agent, with least-privilege choice | Signed and notarized `.dmg` containing the app |

The service must support install, start, stop, restart, status, logs, and clean upgrade. Data must live in OS-appropriate application data directories, not inside the install directory or a transient AppImage mount. The installer must never delete the data directory during an ordinary upgrade or uninstall without explicit confirmation.

### 6.3 Hosting modes

Use one Server codebase and one API contract:

- **Self-hosted:** Server installed on the user's computer or local dedicated machine. Data stays on that host.
- **Centrally hosted:** the same Server service runs on a dedicated central machine/VPS/cloud VM with persistent storage. The desktop dashboard remains the only administration UI and connects through a secure private management route.
- Do not create a separate browser dashboard or a second incompatible cloud account system.
- Start with one authoritative Server instance per deployment. Replication/high availability can be a later phase; do not imply that multiple independent SQLite databases automatically synchronize.

### 6.4 Network modes

**Mode 1 — Direct computer hotspot**

- The Server host creates a private Wi-Fi access point only when its adapter, driver, OS, and permissions support it.
- Detect capability before offering the mode; show a clear unavailable reason if unsupported.
- Use OS-supported interfaces (for example, Windows tethering/hotspot APIs, NetworkManager/D-Bus on Linux, and supported macOS Internet Sharing controls). Do not depend on shell commands that silently assume a particular distribution or driver.
- Configure WPA2-AES/WPA3 and a strong generated passphrase. Keep application authentication mandatory.
- If hotspot creation is unavailable, offer router/LAN mode; do not make hotspot support a prerequisite for Server operation.

**Mode 2 — Existing router/Ethernet LAN**

- Bind only to configured interfaces or clearly show which interfaces are exposed.
- Use mDNS/DNS-SD for discovery on the same link, with stable Server ID verification.
- Support explicit IP/DNS configuration as a fallback.
- Provide firewall guidance and avoid broad public-profile firewall rules.

**Mode 3 — Multiple locations**

- Use WireGuard or another explicitly configured VPN/private network between sites.
- Configure a stable private DNS name or address for the central Server.
- mDNS is not a multi-site discovery protocol; do not rely on multicast crossing routed VPNs.
- Permit Android and desktop clients to connect to the trusted VPN Server profile after certificate/Server-ID verification.
- Do not expose the Server port directly to the public Internet or assume NAT traversal is already implemented.
- Internet access may carry the VPN tunnel, but the AirMesh protocol itself must not require a public cloud dependency. A private leased line or point-to-point link is also valid.

### 6.5 Desktop dashboard information architecture

The dashboard should be professional, fast, and useful at a glance. Recommended sections:

1. **Overview:** total registered Nodes, online Nodes, offline Nodes, active devices, active sessions, uptime, Server health, CPU/RAM/disk, current upload/download rate, and recent warnings.
2. **Nodes:** searchable Node inventory, Node ID, username/display name, registration time, online state, last seen, device count, active sessions, and per-Node traffic.
3. **Devices and Sessions:** device name/platform, first/last seen, session status, expiry, revoke action, and session history.
4. **Network:** active interfaces, address, selected network mode, hotspot status, connected Wi-Fi clients where OS exposes them, total inbound/outbound rate, traffic history, and VPN/site status.
5. **Activity:** recent account, Node, messaging, channel, class, and device events with filters.
6. **Logs:** structured service logs, severity filters, search, export, rotation status, and redaction.
7. **Security:** administrator sessions, Node/device sessions, TLS certificate state, failed-login/rate-limit events, key rotation, recovery controls, and audit log.
8. **Storage and Backups:** database/media usage, quotas, backup schedule, last successful backup, integrity result, restore validation, and retention.
9. **Settings:** Server name/ID, ports, interface binding, network modes, trusted certificates, retention, storage, notifications, and administrator controls.
10. **Updates:** installed version, available signed release, changelog, integrity/signature result, staged update, restart window, and rollback status.

Metric definitions must be explicit:
- **Node** = one registered account.
- **Online Node** = a Node with at least one currently authenticated active device session.
- **Device** = one app installation registered to a Node.
- **Session** = one revocable authentication session for a device.
- **Per-Node traffic** = bytes attributed to authenticated REST and WebSocket traffic for that Node; do not estimate it by dividing total interface traffic equally.
- **Interface traffic** = OS-level network bytes for the selected interface and includes unrelated machine traffic unless the platform can isolate the Server process.

## 7. Data and API target

### 7.1 Migration-safe data model

Keep existing `accounts.id` values as stable Node IDs during the first migration. Add tables/fields incrementally:

- `schema_migrations`: ordered migration IDs and applied timestamps.
- `accounts` (Node): existing username and password verifier plus display name, status, created/updated timestamps, and versioned password-hash metadata.
- `devices`: device ID, Node/account ID, display name, platform, app version, public-key/fingerprint metadata, created/last-seen/revoked timestamps.
- `sessions`: existing session ID and token digest plus device ID, token type, expiry, last-used, revoked timestamp, and session metadata.
- `conversations`, `conversation_members`, `messages`, `message_receipts`.
- `channels`, `channel_members`, `channel_messages`.
- `live_classes`, `live_class_members`, `call_signaling_events` (short retention).
- `attachments` metadata with file storage outside SQLite.
- `sync_events` or an equivalent durable ordered change log and per-device sync cursor.
- `idempotency_keys` with scope, request digest, response reference, and expiry.
- `admin_audit_events`, `server_settings`, and backup metadata.

Use foreign keys, indexes, transactions, bounded payload sizes, retention policies, and cursor pagination. A Node must only read/write resources for which it has membership/permission. Use soft deletion/tombstones where offline clients need to learn that an item was removed.

### 7.2 API contract rules

- Maintain one versioned contract under `/api/v1`, published from the Server repository and referenced by Android.
- Use one consistent success/error envelope and document exceptions such as the initial health endpoint.
- Keep username/password registration and login as the canonical user access flow.
- After login, register/refresh the Android device against the authenticated Node and issue a revocable device-associated session. Do not require an administrator to approve every normal user login.
- The Android app uses the same account/device session token for REST and WebSocket; do not maintain a disconnected account token and pairing token.
- The dashboard's management API is separate from the user API and reachable only over protected local IPC or the configured private admin network.
- Mutating operations accept idempotency keys; sync uses opaque durable cursors.
- The WebSocket authenticates in the Authorization header, authorizes every subscription, checks revocation/expiry, emits unique event IDs, and supports reconnect plus durable sync.
- Version capabilities in `/api/v1/server/info` so the app can adapt without guessing.

## 8. Metrics, logs, backups, and updates

### Metrics

- Sample service CPU, memory, uptime, database size, media storage, and OS network-interface counters.
- Instrument HTTP request/response bytes and WebSocket frame bytes after authentication to attribute application traffic to Nodes.
- Keep sampling intervals and retention configurable. Dashboard values should show units and sampling time.
- Avoid storing message bodies in metrics or logs.

### Logs and audit

- Structured logs with request ID, timestamp, severity, component, event code, and safe context.
- Redact Authorization headers, cookies, passwords, recovery keys, signing secrets, private keys, and message content.
- Separate operational logs from administrator audit events.
- Rotate logs and cap disk usage.

### Backups and restore

- Use SQLite's online backup API or a quiesced/consistent snapshot procedure; do not copy a live database file without handling WAL state.
- Back up the database, media directory, and required key material as a coordinated set.
- Encrypt backup archives and protect their keys separately.
- Verify backups by restoring to a temporary directory and running integrity/migration checks.
- Document retention, off-host backup, and disaster-recovery steps.

### Release and update pipeline

Create a Server-specific GitHub Actions workflow with:

- CI on pull requests: lint/static checks, unit tests, integration tests, database migration tests, API contract tests, and packaging smoke tests.
- Build matrix: Windows, Linux, and macOS; x64 first, ARM64 where dependencies and runners permit.
- Deliverables: Windows `.exe` installer, Linux `.deb` and AppImage, RPM when the build/release toolchain is reliable, and macOS `.dmg`.
- Bundle a pinned Node runtime and all required dependencies so users do not install Node.js or run npm commands.
- Include Qt runtime/deployment dependencies for the native desktop app.
- Generate SHA-256 checksums, SBOM, build provenance, and signed release metadata.
- Sign Windows installers with Authenticode and macOS artifacts with Developer ID and notarization when signing credentials are configured. Linux packages should have verifiable checksums and signed release metadata.
- Publish immutable versioned releases from `vMAJOR.MINOR.PATCH` tags, attach release notes and all platform artifacts, and retain previous releases.
- Never delete older GitHub Releases as part of publishing a new version.
- Test upgrade, data preservation, uninstall behavior, service restart, and rollback on clean VMs for each OS.

The Android repository currently has a separate `.github/workflows/release.yml` that builds a debug APK, also builds legacy ESP/Pi components, and deletes older GitHub Releases before publishing. Do not copy that release-cleanup behavior into the Server pipeline. The Server pipeline must be independent and preserve release history.

## 9. Phased implementation roadmap

### Phase 1 — Audit and specification (this phase)

Deliverables:
- Audit both default branches, recent merged work, current API, data model, security posture, discovery, Android client integration, and CI/release state.
- Record the approved target architecture and phased plan.
- Make documentation-only changes; preserve all application code and repository history.

Exit criteria: this document and the [Android integration companion document](./ANDROID-INTEGRATION.md) are committed on reviewable branches. No application feature is claimed complete.

### Phase 2 — Server core, migrations, and API compatibility

Priority: highest.

Work:
1. Refactor `src/server.js` into configuration, database, migrations, authentication, route modules, WebSocket, and service lifecycle modules without changing existing behavior unnecessarily.
2. Add a lockfile, Node version policy, test runner, lint/check scripts, and CI.
3. Add migration tracking and additive migrations for device/session metadata. Preserve existing account IDs, password hashes, recovery hashes, sessions, and server ID.
4. Add versioned password hashing with Argon2id for new/rehash operations; verify existing bcrypt hashes and rehash only after successful login.
5. Implement device registration and one unified account/device session lifecycle. Keep recovery one-time and test revocation.
6. Reconcile the single API contract with the Android client. Add contract tests for register/login/recover/me, health/info, errors, authorization, and WebSocket handshake.
7. Implement conversation/message persistence and idempotency only after the authentication and contract tests pass.
8. Add session expiry/revocation handling for already-open WebSockets.

Exit criteria:
- Existing database opens without data loss.
- Migration and rollback/backup procedures are tested.
- Android account access can authenticate against the Server.
- No endpoint is documented as implemented unless integration tests prove it.
- No secret or token appears in test logs.

### Phase 3 — Android client migration

Work:
1. Make username/password account access the single normal sign-in/sign-up path.
2. Replace the legacy pairing token with the unified account/device session token.
3. Align `/me` parsing, discovery, API envelope, event protocol, and error handling.
4. Add explicit trusted Server profiles for LAN, hotspot, and VPN/central deployments.
5. Add mDNS discovery for same-link networks and manual/QR trusted endpoint setup for VPN/routed networks.
6. Migrate local cached messages and pending outbox items without losing unsent user data.
7. Retire the embedded Android Server only after every dependent feature has moved to the desktop Server.
8. Restrict cleartext traffic to development-only configuration and use validated TLS for production profiles.

Exit criteria: Android register/login/recovery, device enrollment, message send/receive, reconnect, offline queue, and sync pass automated contract tests and real phone-to-host LAN tests.

### Phase 4 — Desktop service and native dashboard

Work:
1. Add a native Qt 6/QML desktop shell for Windows/Linux/macOS.
2. Package the Node Server core with a private runtime; no separate Node installation for users.
3. Add Windows Service, systemd, and launchd lifecycle integration.
4. Implement protected local IPC for the dashboard and separate administrator identity/setup.
5. Implement dashboard sections in the information architecture above.
6. Add metrics collection, structured logs, audit events, backup/restore, and configuration validation.
7. Ensure closing the dashboard does not stop the background service.

Exit criteria: install/start/stop/restart/uninstall works on clean OS VMs; dashboard shows truthful metrics and cannot be reached as a public web page.

### Phase 5 — Network modes and hosting

Work:
1. Implement capability-detected computer Wi-Fi hotspot support with OS-native adapters.
2. Complete router/Ethernet LAN mode and firewall guidance.
3. Add secure VPN/private-link profiles and trusted DNS endpoints for multiple locations.
4. Add central-host deployment configuration using the same Server core and dashboard.
5. Make mDNS explicitly local-link only and provide trusted manual/QR endpoint setup for routed links.

Exit criteria: isolated local hotspot and router LAN work without Internet; a two-site VPN test works without public port forwarding; unsupported hotspot hardware falls back gracefully.

### Phase 6 — Installers, signing, CI, and releases

Work:
1. Add cross-platform build/test/package workflows and pinned build toolchains.
2. Produce Windows EXE, Linux DEB/AppImage, and macOS DMG; add RPM after smoke tests.
3. Add signing, checksums, SBOM, provenance, release notes, and version checks.
4. Test install, upgrade, data preservation, service recovery, uninstall, and rollback.
5. Publish versioned releases while retaining every prior release.

Exit criteria: each platform artifact installs on a clean supported VM and passes a smoke test; release assets verify against published checksums/signatures.

### Phase 7 — Full communication feature completion

Work:
1. Direct/group messaging, history, receipts, edits/deletes, and membership enforcement.
2. Channels, channel messages, moderation/roles.
3. Live Classes, membership, WebRTC signaling, and TURN/STUN strategy where required.
4. Attachment upload/download, quotas, retention, and secure storage.
5. Durable sync, tombstones, conflict rules, presence, typing, notifications, and recovery testing.

Exit criteria: automated API/Android integration tests and real-device end-to-end scenarios cover online, offline, reconnect, multi-device, and multi-site use.

## 10. Phase 2 implementation order and guardrails

The next code phase should start in the Server repository and proceed in small reviewable pull requests:

1. Add test harness and lockfile before refactoring.
2. Capture current API behavior with tests.
3. Add database migration infrastructure and backup verification.
4. Split modules while keeping endpoints stable.
5. Add device/session lifecycle and authentication hardening.
6. Add contract tests against Android's actual client calls.
7. Only then add messaging endpoints and expand the desktop app.

Do not:
- rewrite both repositories at once;
- delete Android local-server code before its responsibilities and data have migrated;
- reintroduce a browser admin page;
- require a Gateway or ESP device for Server operation;
- expose admin controls through Android;
- expose a public unauthenticated management port;
- use a shared default admin password;
- silently fall back from local operation to an Internet backend;
- delete old release assets;
- claim a platform, hotspot, VPN, installer, or hardware test passed without executing it.

## 11. Validation performed and limitations

- Repository metadata, default branches, recent commits, merged/open PR listings, selected source/configuration/documentation files, Android release workflow, and API client files were inspected through GitHub.
- No application source or runtime configuration was changed in Phase 1.
- No local Android SDK/Gradle environment, Windows/Linux/macOS build runners, installed Server dependencies, physical Android phone, Wi-Fi adapter, hotspot, or multi-site VPN lab was available in this audit execution.
- The current Server `npm run check` and Android Gradle tests were therefore **not run here**. Historical PR descriptions are not treated as proof that the latest default-branch commits pass.
- The GitHub combined-status query for the audited Android head returned no status entries. This is not proof of a passing build.
- The Server package has no test script; the only declared check is a syntax check of `src/server.js`. No Server workflow/test files were surfaced by the searches performed.
- Full clean-VM installer, signing, hotspot, VPN, physical phone, and end-to-end verification remain future work.

**Phase 1 conclusion:** the architecture is now specified and the principal integration/security risks are recorded. The next useful implementation is Phase 2: Server core, migration-safe persistence, and a single tested API/session contract shared with Android.
