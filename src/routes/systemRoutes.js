import {
  API_VERSION,
  EVENT_PROTOCOL_VERSION,
  MDNS_CONFIG,
  SERVER_VERSION
} from "../config/constants.js";
import { nowIso } from "../security/crypto.js";
import { sendSuccess } from "./errorEnvelope.js";

export function registerSystemRoutes(app, ctx) {
  const { config, serverId, tlsContext, getCapabilities, metricsService } = ctx;

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
}
