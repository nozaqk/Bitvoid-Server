# BitVoid Server

BitVoid Server is the standalone, cross-platform application Server for BitVoid. It runs as ordinary software on a Windows, Linux, or macOS computer or laptop.

**No ESP8266, ESP-12E, Arduino IDE, or separate Gateway device is required.** The Server computer and Android phone communicate directly over an existing private Wi-Fi network, phone hotspot, or LAN. Internet access is not required after Node.js and the dependencies have been installed.

> This README is the complete setup and operating guide. Follow the steps for your operating system.

## 1. Architecture

- **Android BitVoid app:** the only user-facing BitVoid client.
- **BitVoid Server:** account registration, login, recovery, local persistence, and authenticated real-time connection foundation.
- **Host computer:** any supported Windows, Linux, or macOS desktop/laptop.
- **Network:** an existing private Wi-Fi/LAN. The Server does not create a Wi-Fi hotspot.
- **Database:** SQLite stored locally on the host computer.
- **Discovery:** mDNS/DNS-SD advertises the Server on the local network.

The Server is not the Gateway and does not need an ESP device. Do not use the former ESP Gateway address (for example, 192.168.4.1) as the Server address unless that address is actually assigned to the computer running this software.

## 2. Requirements

- Node.js **20 or newer** (npm is included with Node.js).
- Windows 10/11, a current Linux distribution, or macOS.
- A computer and Android phone connected to the same private Wi-Fi/LAN.
- An available TCP port, default **8787**.
- Enough disk space for Node dependencies and the local SQLite database.

Install Node.js LTS from https://nodejs.org/. Verify installation:

```bash
node --version
npm --version
```

The Node version must be 20 or newer.

## 3. Download the Server

### Option A — Download ZIP (no Git required)

1. Open https://github.com/nozaqk/Bitvoid-Server.
2. Select **Code → Download ZIP**.
3. Extract the ZIP file.
4. Open a terminal in the extracted `Bitvoid-Server` folder. This folder must contain `package.json`, `.env.example`, and `src/server.js`.

### Option B — Clone with Git

```bash
git clone https://github.com/nozaqk/Bitvoid-Server.git
cd Bitvoid-Server
```

## 4. First-time setup — Windows

Open **PowerShell** in the repository root folder.

### Step 1: Install dependencies

```powershell
npm install
```

Wait for npm to finish. This installs Fastify, SQLite, authentication, WebSocket, and local discovery dependencies.

### Step 2: Create your private environment file

```powershell
Copy-Item .env.example .env
```

### Step 3: Generate a strong Server secret

Run:

```powershell
$secret = [Convert]::ToBase64String([Security.Cryptography.RandomNumberGenerator]::GetBytes(48))
$secret
```

Copy the generated value. Open the environment file:

```powershell
notepad .env
```

Replace the example value after `BITVOID_TOKEN_SECRET=` with the generated value. Save and close Notepad.

**Important:** keep `.env` private. Never post the secret in a chat, commit it to Git, or share it publicly. The `.gitignore` file excludes it.

### Step 4: Start the Server

```powershell
npm start
```

Keep this terminal window open while using BitVoid. The first successful start creates the `data` folder and SQLite database automatically.

Expected log message:

```text
BitVoid Server listening on 0.0.0.0:8787 with mDNS discovery
```

The exact log format may include timestamps and other Fastify details.

### Step 5: Check the Server on the same computer

Open a second PowerShell window and run:

```powershell
Invoke-RestMethod http://127.0.0.1:8787/api/v1/health
```

A successful response includes `ok: true`, `status: ready`, an API version, and a Server ID.

You can also open this address in the host computer's browser:

```text
http://127.0.0.1:8787/api/v1/health
```

## 5. First-time setup — Linux

Open a terminal in the repository root:

```bash
cp .env.example .env
npm install
```

Generate a unique secret:

```bash
openssl rand -base64 48
```

Edit `.env` with your preferred text editor and replace the example `BITVOID_TOKEN_SECRET` value with the generated secret. Then start the Server:

```bash
npm start
```

Test it from another terminal:

```bash
curl http://127.0.0.1:8787/api/v1/health
```

## 6. First-time setup — macOS

Open Terminal in the repository root:

```bash
cp .env.example .env
npm install
openssl rand -base64 48
```

Put the generated value into `.env` as `BITVOID_TOKEN_SECRET`, then start and test:

```bash
npm start
```

In a second Terminal window:

```bash
curl http://127.0.0.1:8787/api/v1/health
```

## 7. Connect the Android phone over local Wi-Fi

### Step 1: Put both devices on the same network

Connect the Android phone and the computer running BitVoid Server to the same private Wi-Fi network, router, or phone hotspot.

- Internet access is not needed for local communication.
- A guest Wi-Fi network may block communication between connected devices. Use a trusted network that allows local device-to-device traffic.
- Do not enable client/AP isolation if it prevents the phone from reaching the computer.

### Step 2: Find the computer's local IPv4 address

**Windows PowerShell:**

```powershell
ipconfig
```

Find the active Wi-Fi or Ethernet adapter and note its **IPv4 Address**. Ignore disconnected adapters and virtual adapters.

**Linux:**

```bash
ip -4 addr
```

Find the IPv4 address of the active Wi-Fi/Ethernet interface.

**macOS (Wi-Fi interface is commonly en0):**

```bash
ipconfig getifaddr en0
```

Use the actual address reported by your computer. It may change when you reconnect to Wi-Fi.

### Step 3: Allow TCP port 8787 through the computer firewall

Only allow connections on a trusted **private/local network**. Do not expose this Server to public networks.

**Windows:** open PowerShell as Administrator and run:

```powershell
New-NetFirewallRule -DisplayName "BitVoid Server (Private LAN)" -Direction Inbound -Protocol TCP -LocalPort 8787 -Action Allow -Profile Private
```

To remove the rule later:

```powershell
Remove-NetFirewallRule -DisplayName "BitVoid Server (Private LAN)"
```

If Windows identifies your trusted Wi-Fi network as Public, review the network profile and firewall policy carefully rather than creating a broad public firewall rule.

**Linux:** firewall commands depend on your distribution. If using UFW, allow the port only from your trusted LAN subnet. Example for a LAN using `192.168.1.0/24`:

```bash
sudo ufw allow from 192.168.1.0/24 to any port 8787 proto tcp
sudo ufw status
```

Replace the example subnet with your actual LAN subnet.

**macOS:** allow incoming connections for the Node.js process when macOS prompts you. Check your firewall settings if the phone cannot connect.

### Step 4: Test from the phone

Replace `HOST-LAN-IP` with the computer's actual IPv4 address:

```text
http://HOST-LAN-IP:8787/api/v1/health
```

Example only (your address will likely be different):

```text
http://192.168.1.25:8787/api/v1/health
```

The phone should receive a JSON health response. If this works, the local network path to the Server is working.

### Step 5: Open the BitVoid Android app

The Server advertises itself using mDNS/DNS-SD. The Android app can use local discovery where supported. If discovery does not work on a particular Wi-Fi network, the app needs a manual Server URL setting or another supported discovery route. Use:

```text
http://HOST-LAN-IP:8787
```

The Android app must be configured to connect to the **computer running BitVoid Server**, not to an old ESP Gateway address.

## 8. Start, stop, and update the Server

- **Start:** from the repository root, run `npm start`.
- **Development mode:** run `npm run dev` to restart the Node process when source files change.
- **Stop:** focus the terminal running the Server and press `Ctrl+C`.
- **Syntax check:** run `npm run check`.
- **Install/update dependencies:** after pulling or downloading updated source, run `npm install`, then restart with `npm start`.

Keep the computer awake and connected to the same network while the phone needs the local Server. If the computer sleeps, shuts down, changes networks, or its IP changes, the phone may lose its connection.

## 9. Environment configuration

Edit the root `.env` file. Do not commit it.

| Variable | Default | Description |
|---|---|---|
| `BITVOID_TOKEN_SECRET` | Required | Unique random signing secret, minimum 32 characters |
| `BITVOID_HOST` | `0.0.0.0` | Network interface to bind |
| `BITVOID_PORT` | `8787` | TCP listening port |
| `BITVOID_DISPLAY_NAME` | `BitVoid Local Server` | Display name |
| `BITVOID_DATABASE_PATH` | `./data/bitvoid.sqlite` | SQLite database location |
| `BITVOID_TOKEN_TTL` | `7d` | Account session token lifetime |
| `BITVOID_TLS_CERT` | Empty | Optional TLS certificate file path |
| `BITVOID_TLS_KEY` | Empty | Optional TLS private key file path |

The default bind address `0.0.0.0` makes the Server listen on available network interfaces. Firewall rules should restrict access to trusted local networks.

## 10. API endpoints currently implemented

| Method | Endpoint | Purpose |
|---|---|---|
| GET | `/api/v1/health` | Health/readiness response |
| GET | `/api/v1/server/info` | Server ID, version, capabilities and transport |
| POST | `/api/v1/account/register` | Create an account and initial session |
| POST | `/api/v1/account/login` | Log in and create a session |
| POST | `/api/v1/account/recover` | Reset password using recovery key |
| GET | `/api/v1/me` | Return authenticated account |
| POST | `/api/v1/auth/revoke` | Revoke current session |
| WebSocket | `/api/v1/events` | Authenticated connection and ping/pong heartbeat |

Account endpoints accept JSON. Registration/login use a username and password. Usernames must be 2–24 characters and use letters, numbers, dot, underscore, or hyphen. Passwords must be 10–128 characters and no more than 72 UTF-8 bytes (bcrypt limit).

Registration returns an account, session token, and one-time `masterPassphrase` recovery key. **Save the recovery key securely when it is shown; it cannot be retrieved from the Server later.** Passwords are stored as bcrypt hashes; the high-entropy recovery key is stored as a SHA-256 hash. Session tokens are revocable and stored hashed in SQLite.

Authenticated REST calls use:

```http
Authorization: Bearer YOUR_ACCOUNT_TOKEN
```

The WebSocket endpoint requires the account token in the HTTP Authorization header during its handshake. The Android networking implementation must support sending that header.

## 11. Security notes

- Keep the Server on a trusted private Wi-Fi/LAN.
- Do not configure router port forwarding or expose port 8787 to the public internet.
- Keep `.env`, the token secret, database, and backups private.
- Use WPA2-AES or WPA3 Wi-Fi security with a strong password.
- A hidden Wi-Fi name and MAC allowlist are not substitutes for Wi-Fi encryption or application authentication.
- The default HTTP/WS transport is **not encrypted**. Use it only on a trusted private LAN.
- The Server can be configured with TLS certificate and key paths using `BITVOID_TLS_CERT` and `BITVOID_TLS_KEY`. The Android app must separately validate and trust the certificate before using HTTPS/WSS. Do not disable certificate validation or trust arbitrary certificates.
- TLS encrypts the connection between the app and Server; it is not end-to-end encryption between BitVoid users.
- Never put account tokens or secret keys in URLs, query strings, or public logs.

## 12. TLS configuration (optional)

TLS is not enabled by default. To enable it, provide a certificate and matching private key that the Android app can validate. Set their absolute file paths in `.env`:

```env
BITVOID_TLS_CERT=/absolute/path/to/server-cert.pem
BITVOID_TLS_KEY=/absolute/path/to/server-key.pem
```

Restart the Server after changing the configuration. The Server will then serve HTTPS/WSS on the configured port. The certificate must identify the hostname or IP address the app uses, and the app must be configured to trust/validate it. A self-signed certificate is not automatically trusted by Android. Do not use insecure trust-all certificate code.

## 13. Troubleshooting

### The Server does not start

- Check Node.js: `node --version` (must be 20+).
- Run `npm install` in the repository root.
- Confirm `.env` exists and `BITVOID_TOKEN_SECRET` is set to at least 32 characters.
- Check whether port 8787 is already in use.

Windows port check:

```powershell
netstat -ano | findstr :8787
```

If another process owns the port, stop that process safely or change `BITVOID_PORT` in `.env`.

### The phone cannot reach the Server

1. Confirm the Server terminal still shows it is running.
2. Test `http://127.0.0.1:8787/api/v1/health` on the host computer.
3. Confirm the phone and computer are on the same Wi-Fi/LAN.
4. Confirm you used the computer's current LAN IPv4 address.
5. Check the private firewall rule for TCP 8787.
6. Check that the Wi-Fi does not isolate connected devices.
7. Confirm the Server is bound to `0.0.0.0`, not only `127.0.0.1`.

### mDNS discovery does not find the Server

Some routers, guest networks, VPNs, and access points block multicast/mDNS traffic. Test direct access using the computer's LAN IPv4 address and port 8787. mDNS failure does not necessarily mean the Server is offline.

### The phone loses connection

The computer may have slept, changed Wi-Fi networks, shut down, or received a different IP address. Restart the Server if necessary and repeat the health test.

## 14. Database and backups

The default database is:

```text
data/bitvoid.sqlite
```

It is created automatically. Keep the database and backups private. For a simple consistent backup, stop the Server with `Ctrl+C`, copy the database file to a secure location, then start the Server again. Do not commit database files to Git.

## 15. Current implementation scope and limitations

This repository currently provides the portable Server foundation, account endpoints, local SQLite persistence for accounts/sessions, health and identity endpoints, mDNS advertisement, and authenticated WebSocket connection/heartbeat.

The following product features are **not implemented yet** and must not be treated as working:

- Direct and group conversations, message storage/history, and delivery/read receipts.
- Channels and channel messages.
- Live Classes, membership, and signaling.
- File and attachment transfer.
- Durable offline message synchronization.
- Presence, typing indicators, and full real-time event broadcasting.
- Complete administration and account-management workflows.

The Android app also requires integration and end-to-end testing against this standalone Server. A successful Server health check alone does not mean all BitVoid app features are ready.

## 16. Repository

- Source: https://github.com/nozaqk/Bitvoid-Server
- Issues: https://github.com/nozaqk/Bitvoid-Server/issues
- Android app: https://github.com/nozaqk/BitVoid

