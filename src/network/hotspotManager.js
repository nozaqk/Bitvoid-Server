import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { randomBytes } from "node:crypto";

const execFileAsync = promisify(execFile);

async function defaultCommandRunner(command, args, timeoutMs = 8000) {
  try {
    const { stdout, stderr } = await execFileAsync(command, args, {
      timeout: timeoutMs,
      windowsHide: true
    });
    return { ok: true, code: 0, stdout: String(stdout || ""), stderr: String(stderr || "") };
  } catch (err) {
    return {
      ok: false,
      code: typeof err.code === "number" ? err.code : -1,
      stdout: String(err.stdout || ""),
      stderr: String(err.stderr || err.message || ""),
      notFound: err.code === "ENOENT"
    };
  }
}

export function generateHotspotPassphrase() {
  // 16 random bytes -> 22+ URL-safe high-entropy WPA2/WPA3 passphrase chars
  return randomBytes(16).toString("base64url");
}

function validateSsid(ssid) {
  if (typeof ssid !== "string") return false;
  const trimmed = ssid.trim();
  const bytes = Buffer.byteLength(trimmed, "utf8");
  return bytes >= 1 && bytes <= 32 && !/[\r\n\u0000]/.test(trimmed);
}

function validatePassphrase(passphrase) {
  if (typeof passphrase !== "string") return false;
  const bytes = Buffer.byteLength(passphrase, "utf8");
  return bytes >= 8 && bytes <= 63 && !/[\r\n\u0000]/.test(passphrase);
}

/**
 * Cross-platform OS-native Wi-Fi Hotspot Capability Detector & Controller.
 * - Never assumes hardware/driver/OS support.
 * - Never assumes root/Administrator privileges.
 * - Uses safe execFile (no shell interpolation) with platform-specific interfaces:
 *   - Linux: NetworkManager (`nmcli`) + `iw list` AP capability check
 *   - Windows: WinRT Mobile Hotspot / `netsh wlan show drivers`
 *   - macOS: honest unsupported programmatic API report + Internet Sharing guidance + LAN fallback
 */
export class HotspotManager {
  constructor({
    platform = process.platform,
    runCommand = defaultCommandRunner,
    auditService = null
  } = {}) {
    this.platform = platform;
    this.runCommand = runCommand;
    this.auditService = auditService;
    this.state = {
      active: false,
      ssid: null,
      interfaceName: null,
      security: "WPA2/WPA3-PSK",
      startedAt: null,
      connectionName: null
    };
  }

  async detectCapability() {
    if (this.platform === "linux") {
      return this._detectLinux();
    }
    if (this.platform === "win32") {
      return this._detectWindows();
    }
    if (this.platform === "darwin") {
      return this._detectMacOS();
    }
    return {
      platform: this.platform,
      supported: false,
      adapter: "unsupported-os",
      wifiInterfaces: [],
      requiresElevation: false,
      reason: `Direct Wi-Fi hotspot hosting is not supported on platform "${this.platform}".`,
      instructions: [
        "Use Mode 2 (Existing Wi-Fi Router or Ethernet LAN) so Android devices reach BitVoid Server over the local network."
      ]
    };
  }

  async _detectLinux() {
    const nmCheck = await this.runCommand("nmcli", ["--version"]);
    if (!nmCheck.ok) {
      return {
        platform: "linux",
        supported: false,
        adapter: "linux-networkmanager",
        wifiInterfaces: [],
        requiresElevation: false,
        reason: "NetworkManager (nmcli) is not installed or unavailable on this Linux host.",
        instructions: [
          "Install and enable NetworkManager to use direct Wi-Fi hotspot mode on Linux.",
          "Alternatively, connect this computer and Android phones to an existing Wi-Fi router or Ethernet LAN (Mode 2)."
        ]
      };
    }

    const devRes = await this.runCommand("nmcli", ["-t", "-f", "DEVICE,TYPE,STATE", "device", "status"]);
    const wifiInterfaces = [];
    if (devRes.ok) {
      for (const line of devRes.stdout.split("\n")) {
        const [device, type, state] = line.trim().split(":");
        if (type === "wifi" && device) {
          wifiInterfaces.push({ name: device, state: state || "unknown" });
        }
      }
    }

    if (wifiInterfaces.length === 0) {
      return {
        platform: "linux",
        supported: false,
        adapter: "linux-networkmanager",
        wifiInterfaces: [],
        requiresElevation: false,
        reason: "No Wi-Fi network adapter was detected by NetworkManager on this machine.",
        instructions: [
          "Attach a Wi-Fi adapter that supports AP mode, or use Mode 2 (Ethernet / existing router LAN)."
        ]
      };
    }

    const iwRes = await this.runCommand("iw", ["list"]);
    const apModeConfirmed = iwRes.ok ? /^\s*\*\s+AP\b/m.test(iwRes.stdout) : null;
    if (apModeConfirmed === false) {
      return {
        platform: "linux",
        supported: false,
        adapter: "linux-networkmanager",
        wifiInterfaces,
        apModeConfirmed: false,
        requiresElevation: false,
        reason: "The installed Wi-Fi adapter driver does not report AP (Access Point) mode support.",
        instructions: [
          "Use an external AP-capable Wi-Fi adapter or run BitVoid Server in Mode 2 (Existing Wi-Fi Router / Ethernet LAN)."
        ]
      };
    }

    return {
      platform: "linux",
      supported: true,
      adapter: "linux-networkmanager",
      wifiInterfaces,
      apModeConfirmed: apModeConfirmed === true ? true : "unverified-iw-unavailable",
      requiresElevation: false,
      permissionNote:
        "Starting a hotspot requires Polkit permission `org.freedesktop.NetworkManager.network-control` (or administrator authorization when prompted).",
      instructions: [
        "Select a Wi-Fi interface, choose an SSID and WPA2/WPA3 passphrase, and activate Hotspot mode from the Desktop Dashboard."
      ]
    };
  }

  async _detectWindows() {
    // Check WinRT Mobile Hotspot tethering capability via PowerShell (non-elevated read check).
    const psScript = [
      "$ErrorActionPreference='Stop'",
      "[Windows.Networking.Connectivity.NetworkInformation,Windows.Networking.Connectivity,ContentType=WindowsRuntime] | Out-Null",
      "[Windows.Networking.NetworkOperators.NetworkOperatorTetheringManager,Windows.Networking.NetworkOperators,ContentType=WindowsRuntime] | Out-Null",
      "$p = [Windows.Networking.Connectivity.NetworkInformation]::GetInternetConnectionProfile()",
      "if ($null -eq $p) { Write-Output 'NO_PROFILE' } else { Write-Output ([Windows.Networking.NetworkOperators.NetworkOperatorTetheringManager]::GetTetheringCapabilityFromConnectionProfile($p)) }"
    ].join("; ");

    const winrt = await this.runCommand("powershell.exe", [
      "-NoProfile",
      "-NonInteractive",
      "-Command",
      psScript
    ]);

    const netsh = await this.runCommand("netsh", ["wlan", "show", "drivers"]);
    const hasWifiDriver = netsh.ok && /Interface name\s*:/i.test(netsh.stdout);
    const hostedSupported = netsh.ok && /Hosted network supported\s*:\s*Yes/i.test(netsh.stdout);
    const winrtText = (winrt.stdout || "").trim();

    if (!hasWifiDriver) {
      return {
        platform: "win32",
        supported: false,
        adapter: "windows-winrt-tethering",
        wifiInterfaces: [],
        requiresElevation: false,
        reason: "No Windows Wi-Fi adapter driver was detected.",
        instructions: [
          "Use Mode 2 (Existing Wi-Fi Router or Ethernet LAN), or install a Wi-Fi adapter that supports Windows Mobile Hotspot."
        ]
      };
    }

    if (winrt.ok && winrtText === "Enabled") {
      return {
        platform: "win32",
        supported: true,
        adapter: "windows-winrt-tethering",
        wifiInterfaces: [{ name: "Wi-Fi", state: "available" }],
        hostedNetworkLegacySupported: hostedSupported,
        requiresElevation: false,
        instructions: [
          "Windows Mobile Hotspot capability is available. Enable WPA2/WPA3 hotspot in the Desktop Dashboard or Windows Settings -> Network & Internet -> Mobile hotspot."
        ]
      };
    }

    return {
      platform: "win32",
      supported: hostedSupported,
      adapter: hostedSupported ? "windows-netsh-hosted" : "windows-winrt-tethering",
      wifiInterfaces: [{ name: "Wi-Fi", state: "detected" }],
      winrtCapability: winrtText || "Unavailable",
      hostedNetworkLegacySupported: hostedSupported,
      requiresElevation: hostedSupported,
      reason: hostedSupported
        ? "WinRT Mobile Hotspot requires an active connection profile; legacy hosted-network mode requires Administrator elevation."
        : `Windows Mobile Hotspot capability reported "${winrtText || "Unavailable"}" and adapter does not support standalone hosted networks.`,
      instructions: [
        "If offline with no active upstream connection, Windows Mobile Hotspot may require enabling Wi-Fi Direct or using a local router (Mode 2).",
        "Always configure a private firewall rule for TCP port 8787 instead of a public profile rule."
      ]
    };
  }

  async _detectMacOS() {
    return {
      platform: "darwin",
      supported: false,
      adapter: "macos-system-settings-only",
      wifiInterfaces: [],
      requiresElevation: false,
      reason:
        "macOS does not provide a supported, unprivileged programmatic API for third-party apps to create an encrypted WPA2/WPA3 Wi-Fi access point directly.",
      instructions: [
        "Option A (Recommended): Connect the Mac and Android phones to an existing Wi-Fi router or Ethernet LAN (Mode 2).",
        "Option B (macOS Internet Sharing): Open System Settings -> General -> Sharing -> Internet Sharing, share from Ethernet to Wi-Fi with WPA2/WPA3 enabled, then connect Android to the Mac's local IP on port 8787."
      ]
    };
  }

  async startHotspot({ ssid = "BitVoid-Local", passphrase = null, interfaceName = null, actorId = "admin" } = {}) {
    const capability = await this.detectCapability();
    if (!capability.supported) {
      const err = new Error(capability.reason || "Wi-Fi hotspot mode is not supported on this host.");
      err.code = "hotspot_unsupported";
      err.capability = capability;
      throw err;
    }

    if (!validateSsid(ssid)) {
      throw new Error("Hotspot SSID must be 1-32 UTF-8 bytes without control characters.");
    }
    const finalPassphrase = passphrase || generateHotspotPassphrase();
    if (!validatePassphrase(finalPassphrase)) {
      throw new Error("Hotspot WPA2/WPA3 passphrase must be 8-63 characters.");
    }

    if (this.platform === "linux") {
      const targetIf = interfaceName || capability.wifiInterfaces[0]?.name;
      if (!targetIf || !/^[a-zA-Z0-9._-]{1,32}$/.test(targetIf)) {
        throw new Error("Invalid Wi-Fi interface name.");
      }

      const conName = "bitvoid-hotspot";
      // Remove any previous bitvoid-hotspot profile cleanly before activating.
      await this.runCommand("nmcli", ["connection", "delete", conName]);

      const res = await this.runCommand("nmcli", [
        "device",
        "wifi",
        "hotspot",
        "ifname",
        targetIf,
        "con-name",
        conName,
        "ssid",
        ssid.trim(),
        "password",
        finalPassphrase
      ]);

      if (!res.ok) {
        const denied = /not authorized|permission|privilege|polkit/i.test(res.stderr);
        const err = new Error(
          denied
            ? `Insufficient permissions to start Wi-Fi hotspot on ${targetIf}. Grant NetworkManager network-control permission or run in LAN mode.`
            : `Failed to start Linux Wi-Fi hotspot on ${targetIf}: ${res.stderr.trim() || "unknown error"}`
        );
        err.code = denied ? "hotspot_permission_denied" : "hotspot_start_failed";
        throw err;
      }

      this.state = {
        active: true,
        ssid: ssid.trim(),
        interfaceName: targetIf,
        security: "WPA2/WPA3-PSK",
        startedAt: new Date().toISOString(),
        connectionName: conName
      };

      if (this.auditService) {
        this.auditService.record({
          actorType: "admin",
          actorId,
          action: "network.hotspot.start",
          targetType: "interface",
          targetId: targetIf,
          outcome: "success",
          details: { ssid: this.state.ssid, security: this.state.security }
        });
      }

      return {
        ...this.state,
        // Returned once to the local Desktop Dashboard administrator so they can display/QR it.
        passphrase: finalPassphrase
      };
    }

    if (this.platform === "win32") {
      const err = new Error(
        "Use Windows Settings -> Network & Internet -> Mobile hotspot or run the BitVoid Windows Helper with tethering permissions to activate the hotspot cleanly."
      );
      err.code = "hotspot_windows_manual_step";
      throw err;
    }

    throw new Error("Hotspot activation is not available on this platform.");
  }

  async stopHotspot({ actorId = "admin" } = {}) {
    if (!this.state.active) {
      return { stopped: true, wasActive: false };
    }

    if (this.platform === "linux" && this.state.connectionName) {
      await this.runCommand("nmcli", ["connection", "down", this.state.connectionName]);
    }

    const prevIf = this.state.interfaceName;
    this.state = {
      active: false,
      ssid: null,
      interfaceName: null,
      security: "WPA2/WPA3-PSK",
      startedAt: null,
      connectionName: null
    };

    if (this.auditService) {
      this.auditService.record({
        actorType: "admin",
        actorId,
        action: "network.hotspot.stop",
        targetType: "interface",
        targetId: prevIf,
        outcome: "success"
      });
    }

    return { stopped: true, wasActive: true };
  }

  getStatus() {
    return { ...this.state };
  }
}
