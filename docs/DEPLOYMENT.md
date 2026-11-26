# Deployment and LAN setup

The Server runs as a process on a general-purpose computer, not on ESP hardware. The Android phone reaches the computer's LAN IP on TCP port 8787.

## Windows Firewall

Run PowerShell as Administrator:

New-NetFirewallRule -DisplayName "BitVoid Server (Private LAN)" -Direction Inbound -Protocol TCP -LocalPort 8787 -Action Allow -Profile Private

Remove the rule when no longer needed:

Remove-NetFirewallRule -DisplayName "BitVoid Server (Private LAN)"

Do not create a public-profile rule or router port-forward.

## TLS

Set BITVOID_TLS_CERT and BITVOID_TLS_KEY to readable certificate/key file paths. Use a certificate identity that the Android app validates. Do not disable certificate validation or accept arbitrary self-signed certificates. Android certificate trust/pinning is a separate integration task.

## Data and backups

SQLite is stored at BITVOID_DATABASE_PATH. Stop the Server before copying the database for a simple consistent backup. Keep backups private.
