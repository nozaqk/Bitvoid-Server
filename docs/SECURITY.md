# BitVoid Server Security Architecture

## Core Security Controls Implemented & Tested

1. **Password Storage (`src/security/passwords.js`):**
   - New accounts and password updates use **Argon2id** (`memoryCost: 64 MiB`, `timeCost: 3`, `parallelism: 1` in production).
   - Legacy **bcrypt** hashes from v1 databases verify transparently and automatically rehash to Argon2id upon successful login without forcing password resets.
   - Plaintext passwords and recovery secrets are never stored or logged.

2. **Recovery Keys (`src/services/authService.js`):**
   - 176-bit random hex recovery key (44 hex chars) displayed once at registration or rotation; only its SHA-256 digest is stored.
   - Account recovery revokes **all** existing sessions and immediately terminates all live WebSocket connections for that Node.

3. **Sessions, Refresh Rotation & Reuse Detection (`src/services/sessionService.js`, `src/realtime/eventHub.js`):**
   - Access JWTs are pinned to `HS256` with strict `iss` (`bitvoid-server`) and `aud` (`bitvoid-app`) verification; tokens are stored hashed (SHA-256) in SQLite.
   - Refresh tokens (`bvr_...`, 384-bit entropy) rotate on every refresh. Presenting an already-revoked/rotated refresh token triggers **reuse detection**, defensively revoking all active sessions on that device and logging `security.refresh_token_reuse_detected`.
   - Revoking a session, revoking a device, or suspending a Node immediately closes active WebSockets (`4001`/`4003`/`4004`).

4. **Brute-Force & Abuse Protections (`src/security/rateLimiter.js`):**
   - Route-specific IP rate limiting (`@fastify/rate-limit`) PLUS account/identifier-keyed sliding-window lockout (`KeyedRateLimiter`) that mitigates distributed multi-IP brute-force attacks.

5. **Administration Isolation & Zero Default Passwords (`src/services/adminAuthService.js`, `src/ipc/adminIpcServer.js`):**
   - No `/admin` or browser dashboard routes exist on the HTTP server.
   - Administration runs exclusively over a local Unix domain socket (`chmod 0600`) or Windows Named Pipe.
   - Administrator accounts are separate from Node accounts, use an HKDF-derived distinct JWT signing subkey (`adminSigningKey`), and initialize via a single-use random local enrollment code (`first-run-enrollment.txt`, `0600`, deleted automatically on setup).

6. **Encrypted Secrets, Encrypted Backups & Redacted Logs:**
   - Sensitive Server config values are encrypted at rest with AES-256-GCM + per-key AAD (`src/security/configStore.js`).
   - Online SQLite + media backups support passphrase-derived AES-256-GCM encryption and isolated temp-dir restore verification (`src/services/backupService.js`).
   - Structured logs redact `Authorization`, passwords, recovery keys, JWTs, refresh tokens, private keys, and message bodies (`src/security/redaction.js`).

7. **Input Validation, SQL Injection & File Safety:**
   - Parameterized SQLite queries throughout; strict validators for usernames, passwords, opaque IDs, and pagination.
   - Streaming multipart uploads sanitize filenames (neutralizing `../`, backslashes, null bytes), enforce max file size (including busboy truncation detection) and per-Node quotas, enforce scope membership authorization on download, and send `X-Content-Type-Options: nosniff` + `Content-Disposition: attachment`.
