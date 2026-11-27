import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { execFileSync } from "node:child_process";
import { classifyIpv4, classifyIpv6, inspectNetworkInterfaces } from "../../src/network/interfaceMonitor.js";
import { HotspotManager } from "../../src/network/hotspotManager.js";
import { VpnProfileManager } from "../../src/network/vpnProfileManager.js";
import { loadTlsContext } from "../../src/network/tlsManager.js";
import { UpdateService, compareSemver } from "../../src/services/updateService.js";
import { openDatabase } from "../../src/db/database.js";
import { runMigrations } from "../../src/db/migrator.js";
import { MIGRATIONS } from "../../src/db/migrations/index.js";
import { sha256Hex } from "../../src/security/crypto.js";

test("Network interface monitor classifies LAN, VPN overlay, loopback, and public exposure warnings", () => {
  assert.equal(classifyIpv4("192.168.1.25"), "private-lan");
  assert.equal(classifyIpv4("10.8.0.1"), "private-lan");
  assert.equal(classifyIpv4("100.101.102.103"), "vpn-cgnat");
  assert.equal(classifyIpv4("127.0.0.1"), "loopback");
  assert.equal(classifyIpv4("203.0.113.10"), "public");
  assert.equal(classifyIpv6("fd12:3456::1"), "private-ula");

  const inspected = inspectNetworkInterfaces({
    port: 8787,
    tlsEnabled: true,
    hostBind: "0.0.0.0",
    rawInterfaces: {
      lo: [{ address: "127.0.0.1", family: "IPv4", internal: true }],
      wlan0: [{ address: "192.168.1.42", family: "IPv4", internal: false }],
      wg0: [{ address: "10.66.66.1", family: "IPv4", internal: false }],
      eth0: [{ address: "203.0.113.5", family: "IPv4", internal: false }]
    }
  });

  assert.equal(inspected.recommendedLanUrls.length, 1);
  assert.equal(inspected.recommendedLanUrls[0].url, "https://192.168.1.42:8787");
  assert.equal(inspected.recommendedVpnUrls.length, 1);
  assert.equal(inspected.recommendedVpnUrls[0].url, "https://10.66.66.1:8787");
  assert.ok(inspected.publicExposureWarning.includes("203.0.113.5"));
});

test("HotspotManager accurately detects Linux, Windows, and macOS capabilities without faking support", async () => {
  // 1. Linux capable adapter + successful start/stop
  const linuxCapable = new HotspotManager({
    platform: "linux",
    runCommand: async (cmd, args) => {
      if (cmd === "nmcli" && args[0] === "--version") return { ok: true, stdout: "nmcli tool, version 1.44.0" };
      if (cmd === "nmcli" && args.includes("status")) return { ok: true, stdout: "wlan0:wifi:disconnected\neth0:ethernet:connected\n" };
      if (cmd === "iw") return { ok: true, stdout: "\tSupported interface modes:\n\t\t * managed\n\t\t * AP\n" };
      if (cmd === "nmcli" && args[0] === "connection") return { ok: true, stdout: "" };
      if (cmd === "nmcli" && args[2] === "hotspot") return { ok: true, stdout: "Device 'wlan0' successfully activated" };
      return { ok: false, stderr: "unexpected" };
    }
  });

  const cap1 = await linuxCapable.detectCapability();
  assert.equal(cap1.supported, true);
  assert.equal(cap1.apModeConfirmed, true);

  const started = await linuxCapable.startHotspot({ ssid: "BitVoid-Lab" });
  assert.equal(started.active, true);
  assert.equal(started.interfaceName, "wlan0");
  assert.ok(started.passphrase.length >= 16);

  const stopped = await linuxCapable.stopHotspot();
  assert.equal(stopped.stopped, true);
  assert.equal(linuxCapable.getStatus().active, false);

  // 2. Linux driver without AP support -> must report supported=false
  const linuxNoAp = new HotspotManager({
    platform: "linux",
    runCommand: async (cmd, args) => {
      if (cmd === "nmcli" && args[0] === "--version") return { ok: true, stdout: "nmcli 1.44" };
      if (cmd === "nmcli" && args.includes("status")) return { ok: true, stdout: "wlan0:wifi:disconnected\n" };
      if (cmd === "iw") return { ok: true, stdout: "\tSupported interface modes:\n\t\t * managed\n" };
      return { ok: false, stderr: "" };
    }
  });
  const capNoAp = await linuxNoAp.detectCapability();
  assert.equal(capNoAp.supported, false);
  assert.match(capNoAp.reason, /AP/i);

  // 3. Windows WinRT Enabled detection
  const winCapable = new HotspotManager({
    platform: "win32",
    runCommand: async (cmd) => {
      if (cmd === "powershell.exe") return { ok: true, stdout: "Enabled\r\n" };
      if (cmd === "netsh") return { ok: true, stdout: "Interface name: Wi-Fi\nHosted network supported : No\n" };
      return { ok: false, stderr: "" };
    }
  });
  const winCap = await winCapable.detectCapability();
  assert.equal(winCap.supported, true);
  assert.equal(winCap.adapter, "windows-winrt-tethering");

  // 4. macOS reports honest unsupported API with Internet Sharing / LAN fallback instructions
  const macMgr = new HotspotManager({ platform: "darwin" });
  const macCap = await macMgr.detectCapability();
  assert.equal(macCap.supported, false);
  assert.ok(macCap.instructions.length >= 2);
});

test("TLS certificate loader extracts X.509 SHA-256 fingerprint and VpnProfileManager creates trusted server profiles", () => {
  const dir = mkdtempSync(join(tmpdir(), "bitvoid-tls-"));
  const db = openDatabase(":memory:");
  try {
    runMigrations(db, MIGRATIONS);

    // Generate a real test X.509 certificate with openssl
    const keyPath = join(dir, "server.key");
    const certPath = join(dir, "server.crt");
    execFileSync("openssl", [
      "req", "-x509", "-newkey", "rsa:2048", "-nodes",
      "-keyout", keyPath, "-out", certPath,
      "-days", "365", "-subj", "/CN=bitvoid-vpn.internal"
    ], { stdio: "pipe" });

    const tlsCtx = loadTlsContext({ enabled: true, certPath, keyPath, caPath: "" });
    assert.equal(tlsCtx.enabled, true);
    assert.match(tlsCtx.certificateInfo.fingerprint256, /^([0-9A-F]{2}:){31}[0-9A-F]{2}$/);
    assert.ok(tlsCtx.certificateInfo.daysRemaining > 300);

    const vpnMgr = new VpnProfileManager({
      db,
      config: { displayName: "Campus Central", deploymentMode: "centrally-hosted", networkMode: "vpn" },
      serverId: "srv_campus01",
      tlsContext: tlsCtx
    });

    const profile = vpnMgr.createProfile({
      name: "Campus WireGuard Hub",
      provider: "wireguard",
      endpointHost: "10.66.66.1",
      endpointPort: 8787,
      dnsName: "bitvoid.campus.internal"
    });
    assert.equal(profile.provider, "wireguard");
    assert.equal(profile.certFingerprint256, tlsCtx.certificateInfo.fingerprint256);

    const bootstrap = vpnMgr.buildTrustBootstrapPayload({ endpointUrl: "https://bitvoid.campus.internal:8787" });
    assert.equal(bootstrap.serverId, "srv_campus01");
    assert.equal(bootstrap.tlsRequired, true);
    assert.equal(bootstrap.tlsCertFingerprint256, tlsCtx.certificateInfo.fingerprint256);
    assert.equal(vpnMgr.listProfiles().length, 1);
  } finally {
    db.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("UpdateService compares semver and validates artifact SHA-256 digests", () => {
  const dir = mkdtempSync(join(tmpdir(), "bitvoid-upd-"));
  const db = openDatabase(":memory:");
  try {
    runMigrations(db, MIGRATIONS);
    assert.equal(compareSemver("1.2.0", "1.1.0"), 1);
    assert.equal(compareSemver("1.1.0", "1.1.0"), 0);
    assert.equal(compareSemver("1.0.9", "1.1.0"), -1);

    const artifactPath = join(dir, "bitvoid-server-1.2.0.deb");
    writeFileSync(artifactPath, "signed-release-binary-bytes");
    const expectedHash = sha256Hex(Buffer.from("signed-release-binary-bytes"));

    const upd = new UpdateService({ db });
    const status = upd.loadReleaseManifest({
      version: "1.2.0",
      releaseNotes: "Security improvements",
      publishedAt: "2026-12-01T00:00:00Z",
      artifacts: [{ filename: "bitvoid-server-1.2.0.deb", platform: "linux-x64", sha256: expectedHash, sizeBytes: 27 }]
    });
    assert.equal(status.updateAvailable, true);
    assert.equal(status.availableVersion, "1.2.0");

    const ok = upd.verifyArtifactFile(artifactPath, expectedHash);
    assert.equal(ok.ok, true);

    const bad = upd.verifyArtifactFile(artifactPath, "0".repeat(64));
    assert.equal(bad.ok, false);
  } finally {
    db.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
