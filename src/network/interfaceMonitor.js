import os from "node:os";
import { readOsInterfaceCounters } from "../services/metricsService.js";

const VPN_IFACE_RE = /^(wg\d*|tun\d*|tap\d*|utun\d*|tailscale\d*|zt[a-z0-9]+|nordlynx|proton\d*)$/i;

export function classifyIpv4(address) {
  if (!address || typeof address !== "string") return "unknown";
  const parts = address.split(".").map((n) => Number.parseInt(n, 10));
  if (parts.length !== 4 || parts.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) {
    return "unknown";
  }
  const [a, b] = parts;
  if (a === 127) return "loopback";
  if (a === 169 && b === 254) return "link-local";
  if (a === 100 && b >= 64 && b <= 127) return "vpn-cgnat";
  if (a === 10) return "private-lan";
  if (a === 172 && b >= 16 && b <= 31) return "private-lan";
  if (a === 192 && b === 168) return "private-lan";
  return "public";
}

export function classifyIpv6(address) {
  if (!address || typeof address !== "string") return "unknown";
  const lower = address.toLowerCase();
  if (lower === "::1") return "loopback";
  if (lower.startsWith("fe80:")) return "link-local";
  if (lower.startsWith("fc") || lower.startsWith("fd")) return "private-ula";
  return "global";
}

/**
 * Inspect host network interfaces, classify addresses (LAN, VPN overlay, loopback, public),
 * attach OS interface counters where available, and compute safe client connection endpoints.
 */
export function inspectNetworkInterfaces({
  port = 8787,
  tlsEnabled = false,
  hostBind = "0.0.0.0",
  rawInterfaces = null
} = {}) {
  const ifaces = rawInterfaces || os.networkInterfaces();
  const osCounters = readOsInterfaceCounters();
  const protocol = tlsEnabled ? "https" : "http";
  const results = [];
  const recommendedLanUrls = [];
  const recommendedVpnUrls = [];
  let publicExposureWarning = null;

  for (const [name, entries] of Object.entries(ifaces)) {
    if (!Array.isArray(entries)) continue;
    const isVpnName = VPN_IFACE_RE.test(name);
    const addresses = [];

    for (const entry of entries) {
      const family = entry.family === 4 || entry.family === "IPv4" ? "IPv4" : "IPv6";
      const scope =
        family === "IPv4" ? classifyIpv4(entry.address) : classifyIpv6(entry.address);
      const effectiveScope = isVpnName && scope !== "loopback" ? "vpn-overlay" : scope;

      addresses.push({
        address: entry.address,
        family,
        netmask: entry.netmask,
        mac: entry.mac,
        internal: Boolean(entry.internal),
        scope: effectiveScope
      });

      if (!entry.internal && family === "IPv4") {
        const url = `${protocol}://${entry.address}:${port}`;
        if (effectiveScope === "vpn-overlay" || effectiveScope === "vpn-cgnat") {
          recommendedVpnUrls.push({ interface: name, address: entry.address, url });
        } else if (effectiveScope === "private-lan") {
          recommendedLanUrls.push({ interface: name, address: entry.address, url });
        } else if (effectiveScope === "public" && (hostBind === "0.0.0.0" || hostBind === entry.address)) {
          publicExposureWarning =
            `Server is bound to ${hostBind} while interface "${name}" has a public IPv4 address (${entry.address}). ` +
            "Restrict host firewall rules to private LAN / VPN interfaces and never expose AirMesh unencrypted to the public Internet.";
        }
      }
    }

    results.push({
      name,
      isVpnInterface: isVpnName,
      addresses,
      counters: osCounters.interfaces[name] || null
    });
  }

  return {
    hostBind,
    port,
    protocol,
    interfaces: results,
    recommendedLanUrls,
    recommendedVpnUrls,
    publicExposureWarning,
    osCountersAvailable: osCounters.available
  };
}
