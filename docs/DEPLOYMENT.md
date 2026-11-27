# BitVoid Server Deployment Guide

BitVoid Server uses **one unified Server core** for both **self-hosted** (local computer/laptop/dedicated machine) and **centrally hosted** (campus server, VPS, or private cloud VM) deployments. Administration in both modes happens through the native **Qt 6 Desktop Dashboard** (or local **bitvoid-admin** CLI) — never through a browser admin website or the Android app.

No ESP-12E, ESP8266, ESP32, or separate microcontroller gateway is required.

---

## 1. Self-Hosted Deployment

1. Install the platform package for your OS (Windows EXE installer, Linux DEB/RPM/AppImage, or macOS DMG) or run from source with Node.js 22+.
2. Set BITVOID_DEPLOYMENT_MODE=self-hosted and BITVOID_NETWORK_MODE=lan (or hotspot where hardware supports it).
3. On first startup, the Server creates a one-time enrollment file (<dataDir>/first-run-enrollment.txt, mode 0600 by default; the Debian/RPM packages use mode 0640 for the restricted desktop-admin group).
4. Launch the **BitVoid Server Desktop Dashboard**, enter the one-time enrollment code, and create your Server Administrator account (minimum 12-character password). The enrollment file is deleted automatically.

### Linux desktop administration permissions

The DEB package runs the Server as the dedicated `bitvoid` service user and exposes its local administration socket only to the separate `bitvoid-admin` group. The package adds the invoking terminal user to that group when the package manager provides `SUDO_USER`. If the package was installed by a graphical package manager, add your login user manually:

```bash
sudo usermod -aG bitvoid-admin "$USER"
```

Log out and back in after changing group membership. The group can access the local IPC socket and read the one-time enrollment file, but it cannot read the SQLite database or the Server environment file/token secret.

### Windows service installation

The Windows installer bundles the pinned Node.js runtime, the native desktop dashboard, and the WinSW service wrapper. The installer registers **BitVoid Server** as an automatic Windows service and starts it. The native dashboard requests Administrator elevation through UAC because it manages a LocalSystem service and reads the protected first-run enrollment file. The service reads its protected configuration from %ProgramData%\BitVoidServer\server.env; the SQLite database, media, logs, and backups remain in the same persistent data directory across upgrades and uninstall.

The Windows installer only opens TCP port 8787 for the **Private** firewall profile. It does not add a Public-profile firewall exception. The service wrapper and service definition are installed beside the bundled runtime.

---

## 2. Centrally Hosted Deployment

1. Provision a Linux/Windows/macOS host with persistent storage and private VPN connectivity (e.g. WireGuard).
2. Configure the environment file for the operating system:
   ```env
   BITVOID_DEPLOYMENT_MODE=centrally-hosted
   BITVOID_NETWORK_MODE=vpn
   BITVOID_MDNS_ENABLED=false
   BITVOID_TLS_CERT=/etc/bitvoid-server/certs/server.crt
   BITVOID_TLS_KEY=/etc/bitvoid-server/certs/server.key
   ```
3. Bind to the VPN interface IP or restrict host firewall rules strictly to the VPN subnet. **Never** expose unencrypted port 8787, the SQLite database, or the local IPC administration socket to the public Internet.
4. Administer via the local Desktop Dashboard or over SSH using bitvoid-admin (talking to the protected Unix domain socket; packaged Linux installs grant only the bitvoid-admin group access).

### macOS service installation

After dragging **BitVoid Server.app** into `/Applications`, run **Install BitVoid Server.command** from the DMG. It registers a per-user LaunchAgent, creates a unique token secret on first start, and launches the background Server when that user is logged in. The first-run enrollment code is stored in the protected `~/Library/Application Support/BitVoidServer` data directory.

To remove only the LaunchAgent, run **Uninstall BitVoid Server Service.command** from the DMG. This does not delete the app or any database, media, logs, backups, or configuration. The Server service runs in the signed-in user's session; it is not a system-wide daemon.

## 3. OS Background Service Managers

| Platform | Service Manager | Unit / Helper | Default OS Data Directory |
|---|---|---|---|
| Windows | Windows Service (BitVoidServer) | packaging/windows/install-service.ps1 + WinSW | %ProgramData%\BitVoidServer |
| Linux | systemd (bitvoid-server.service) | packaging/linux/bitvoid-server.service | /var/lib/bitvoid-server |
| macOS | launchd (com.bitvoid.server) | packaging/macos/com.bitvoid.server.plist | ~/Library/Application Support/BitVoidServer |

Upgrades and uninstalls preserve the data directory intentionally.

## 4. Firewall Guidance

- **Windows:** Allow TCP port 8787 only on the Private profile.
- **Linux (UFW — restrict to trusted LAN or VPN subnet):**
  ```bash
  sudo ufw allow from 192.168.1.0/24 to any port 8787 proto tcp
  ```
- **macOS:** Allow incoming connections for the BitVoid Server runtime only on trusted private networks.

## 5. Consistent Online Backups & Verified Restoration

BitVoid Server uses SQLite's online backup API (db.backup()) so consistent snapshots work safely while the Server is live in WAL mode.

```bash
BITVOID_BACKUP_PASSPHRASE="your-strong-passphrase" npm run backup -- create
BITVOID_BACKUP_PASSPHRASE="your-strong-passphrase" npm run backup -- verify <backupId>
BITVOID_BACKUP_PASSPHRASE="your-strong-passphrase" npm run backup -- restore <backupId> /path/to/bitvoid.sqlite /path/to/media
```

Always store encrypted backup files and backup passphrases separately and keep both private.
