# BitVoid Three-Mode Networking Architecture

Local BitVoid operation **never requires Internet access or external cloud services**.

---

## Mode 1: Direct Computer-Hosted Wi-Fi Hotspot (`BITVOID_NETWORK_MODE=hotspot`)

- **Capability detection first:** `src/network/hotspotManager.js` probes hardware, driver, OS tools, and permissions before offering hotspot activation. It never claims hotspot support on incapable hardware.
- **Platform adapters:**
  - **Linux:** Probes NetworkManager (`nmcli`) + `iw list` for Wi-Fi adapter `AP` mode support. Generates high-entropy WPA2/WPA3 passphrases and handles Polkit permission errors cleanly without requiring the entire Server process to run as `root`.
  - **Windows:** Probes WinRT `NetworkOperatorTetheringManager` and `netsh wlan show drivers` (`Hosted network supported`), providing clear guidance when an active connection profile or elevation is required.
  - **macOS:** Accurately reports that macOS does not offer an unprivileged programmatic third-party WPA2/WPA3 AP creation API and provides clear fallback instructions (Mode 2 LAN or macOS System Settings -> Sharing -> Internet Sharing).

## Mode 2: Existing Wi-Fi Router or Ethernet LAN (`BITVOID_NETWORK_MODE=lan`)

- The Server binds on the local machine and enumerates active private LAN IPv4/IPv6 interfaces (`src/network/interfaceMonitor.js`), warning clearly if a public IPv4 interface is exposed on `0.0.0.0`.
- **Link-local discovery:** `src/network/discoveryService.js` publishes `_bitvoid-server._tcp` (canonical) and `_http._tcp` (compatibility) with TXT fields containing `serverId`, `api=v1`, `version`, `tls`, and `mode`.
- Manual IP connection (`http(s)://<LAN-IP>:8787`) works identically when routers block multicast/mDNS.

## Mode 3: Multiple Locations via VPN / Private Network Links (`BITVOID_NETWORK_MODE=vpn`)

- Supports WireGuard, Tailscale/Headscale, OpenVPN, ZeroTier, and private point-to-point links via persisted `vpn_profiles` (`src/network/vpnProfileManager.js`).
- mDNS is automatically disabled in `vpn` mode because multicast does not reliably traverse routed VPNs.
- **Trusted Server Identity & TLS Pinning:** `GET /api/v1/server/trust-bundle` and the Desktop Dashboard emit a secret-free `bitvoid-server-profile-v1` bootstrap payload containing `serverId`, `endpointUrl`, `tlsRequired`, and `tlsCertFingerprint256` (X.509 SHA-256) so Android clients verify and pin the exact remote Server identity.
- **Never** forward port `8787` directly to the public Internet or expose the local administration IPC over TCP.
