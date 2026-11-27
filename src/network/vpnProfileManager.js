import { generateOpaqueId, nowIso } from "../security/crypto.js";

const VALID_PROVIDERS = new Set(["wireguard", "tailscale", "headscale", "openvpn", "zerotier", "private-link"]);
const FINGERPRINT_RE = /^([0-9A-Fa-f]{2}:){31}[0-9A-Fa-f]{2}$/;
const HOSTNAME_OR_IP_RE = /^[a-zA-Z0-9._:-]{2,253}$/;

function mapVpnProfile(row) {
  if (!row) return null;
  return {
    id: row.id,
    name: row.name,
    provider: row.provider,
    endpointHost: row.endpoint_host,
    endpointPort: row.endpoint_port,
    serverId: row.server_id,
    certFingerprint256: row.cert_fingerprint256,
    dnsName: row.dns_name,
    enabled: Boolean(row.enabled),
    notes: row.notes,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

/**
 * Multi-Location VPN & Trusted Server Identity Profile Manager (Mode 3).
 * Ensures remote/multi-site connections rely on explicit private/VPN endpoints,
 * stable Server IDs, and pinned TLS certificate fingerprints — never public unencrypted exposure.
 */
export class VpnProfileManager {
  constructor({ db, config, serverId, tlsContext, auditService = null }) {
    this.db = db;
    this.config = config;
    this.serverId = serverId;
    this.tlsContext = tlsContext;
    this.auditService = auditService;
  }

  listProfiles() {
    const rows = this.db
      .prepare("SELECT * FROM vpn_profiles ORDER BY created_at DESC")
      .all();
    return rows.map(mapVpnProfile);
  }

  createProfile({
    name,
    provider = "wireguard",
    endpointHost,
    endpointPort = 8787,
    serverId = null,
    certFingerprint256 = null,
    dnsName = null,
    notes = null,
    actorId = "admin"
  }) {
    if (typeof name !== "string" || name.trim().length < 2 || name.trim().length > 64) {
      throw new Error("VPN profile name must be 2-64 characters.");
    }
    const cleanProvider = String(provider || "wireguard").toLowerCase();
    if (!VALID_PROVIDERS.has(cleanProvider)) {
      throw new Error(`Unsupported VPN provider "${provider}".`);
    }
    if (typeof endpointHost !== "string" || !HOSTNAME_OR_IP_RE.test(endpointHost.trim())) {
      throw new Error("Invalid VPN endpointHost (provide a private VPN IP or private DNS hostname).");
    }
    const port = Number.parseInt(String(endpointPort), 10);
    if (!Number.isInteger(port) || port < 1 || port > 65535) {
      throw new Error("Invalid endpointPort.");
    }
    if (certFingerprint256 && !FINGERPRINT_RE.test(certFingerprint256.trim())) {
      throw new Error("certFingerprint256 must be a colon-separated SHA-256 fingerprint (32 hex pairs).");
    }

    const id = generateOpaqueId("vpn");
    const now = nowIso();
    this.db
      .prepare(
        `INSERT INTO vpn_profiles (
          id, name, provider, endpoint_host, endpoint_port,
          server_id, cert_fingerprint256, dns_name, enabled, notes, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?)`
      )
      .run(
        id,
        name.trim(),
        cleanProvider,
        endpointHost.trim(),
        port,
        serverId || this.serverId,
        certFingerprint256 ? certFingerprint256.trim().toUpperCase() : this.tlsContext?.certificateInfo?.fingerprint256 || null,
        dnsName ? dnsName.trim() : null,
        notes ? String(notes).slice(0, 500) : null,
        now,
        now
      );

    if (this.auditService) {
      this.auditService.record({
        actorType: "admin",
        actorId,
        action: "network.vpn_profile.create",
        targetType: "vpn_profile",
        targetId: id,
        outcome: "success",
        details: { name: name.trim(), provider: cleanProvider, endpointHost: endpointHost.trim(), port }
      });
    }

    return mapVpnProfile(this.db.prepare("SELECT * FROM vpn_profiles WHERE id = ?").get(id));
  }

  deleteProfile(profileId, { actorId = "admin" } = {}) {
    const res = this.db.prepare("DELETE FROM vpn_profiles WHERE id = ?").run(profileId);
    if (res.changes > 0 && this.auditService) {
      this.auditService.record({
        actorType: "admin",
        actorId,
        action: "network.vpn_profile.delete",
        targetType: "vpn_profile",
        targetId: profileId,
        outcome: "success"
      });
    }
    return res.changes > 0;
  }

  /**
   * Build a safe Android Trusted Server Pairing / Bootstrap payload (for QR code or manual import).
   * Contains NO secrets, NO tokens, NO passwords — only public Server identity, endpoints, and TLS pin.
   */
  buildTrustBootstrapPayload({ endpointUrl, profileName = null } = {}) {
    const tlsEnabled = Boolean(this.tlsContext?.enabled);
    return {
      schema: "bitvoid-server-profile-v1",
      serverId: this.serverId,
      displayName: profileName || this.config.displayName,
      deploymentMode: this.config.deploymentMode,
      networkMode: this.config.networkMode,
      endpointUrl: endpointUrl || null,
      transport: tlsEnabled ? "https" : "http",
      tlsRequired: this.config.networkMode === "vpn" || this.config.deploymentMode === "centrally-hosted",
      tlsCertFingerprint256: this.tlsContext?.certificateInfo?.fingerprint256 || null,
      generatedAt: nowIso()
    };
  }
}
