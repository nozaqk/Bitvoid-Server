import {
  API_VERSION,
  EVENT_PROTOCOL_VERSION,
  MDNS_CONFIG,
  SERVER_VERSION
} from "../config/constants.js";
import { nowIso } from "../security/crypto.js";
import { inspectNetworkInterfaces } from "../network/interfaceMonitor.js";
import { sendSuccess } from "./errorEnvelope.js";

export function registerSystemRoutes(app, ctx) {
  const { config, serverId, tlsContext, getCapabilities, metricsService, vpnProfileManager } = ctx;

  // Backward-compatible health endpoint (preserves exact v1 fields).
  app.get("/api/v1/health", async () => ({
    ok: true,
    status: "ready",
    apiVersion: API_VERSION,
    serverVersion: SERVER_VERSION,
    serverId,
    uptimeSeconds: metricsService ? Math.floor((Date.now() - metricsService.startedAtMs) / 1000) : 0
  }));

  // Authoritative Server identity, transport, TLS fingerprint, and truthfully advertised capabilities.
  app.get("/api/v1/server/info", async (request, reply) => {
    return sendSuccess(reply, {
      serverId,
      displayName: config.displayName,
      serverVersion: SERVER_VERSION,
      apiVersion: API_VERSION,
      eventProtocolVersion: EVENT_PROTOCOL_VERSION,
      deploymentMode: config.deploymentMode,
      networkMode: config.networkMode,
      capabilities: getCapabilities(),
      transport: tlsContext.enabled ? "https" : "http",
      tls: {
        enabled: tlsContext.enabled,
        fingerprint256: tlsContext.certificateInfo?.fingerprint256 || null,
        validTo: tlsContext.certificateInfo?.validTo || null
      },
      discovery: {
        serviceType: `_${MDNS_CONFIG.PRIMARY_SERVICE_TYPE}._tcp`,
        compatServiceType: `_${MDNS_CONFIG.COMPAT_SERVICE_TYPE}._tcp`,
        linkLocalOnly: true
      },
      links: {
        health: "/api/v1/health",
        info: "/api/v1/server/info",
        trustBundle: "/api/v1/server/trust-bundle",
        events: "/api/v1/events",
        register: "/api/v1/account/register",
        login: "/api/v1/account/login",
        recover: "/api/v1/account/recover",
        refresh: "/api/v1/auth/refresh",
        me: "/api/v1/me"
      },
      serverTime: nowIso()
    });
  });

  // Public read-only Server Identity & Trust Bootstrap Bundle for Android LAN/Hotspot/VPN profile pinning.
  app.get("/api/v1/server/trust-bundle", async (request, reply) => {
    const netInfo = inspectNetworkInterfaces({
      port: app.server.address()?.port ?? config.port,
      tlsEnabled: tlsContext.enabled,
      hostBind: config.host
    });
    const preferredUrl =
      config.networkMode === "vpn"
        ? netInfo.recommendedVpnUrls[0]?.url || netInfo.recommendedLanUrls[0]?.url || null
        : netInfo.recommendedLanUrls[0]?.url || netInfo.recommendedVpnUrls[0]?.url || null;

    return sendSuccess(reply, {
      profile: vpnProfileManager.buildTrustBootstrapPayload({ endpointUrl: preferredUrl }),
      lanEndpoints: netInfo.recommendedLanUrls,
      vpnEndpoints: netInfo.recommendedVpnUrls
    });
  });
}
