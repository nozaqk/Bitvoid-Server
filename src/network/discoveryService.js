import { Bonjour } from "bonjour-service";
import { API_VERSION, MDNS_CONFIG } from "../config/constants.js";

/**
 * Standardized link-local mDNS/DNS-SD discovery service.
 * Publishes both `_bitvoid-server._tcp` (canonical) and `_http._tcp` (Android v1 compatibility)
 * with stable TXT identity fields (`serverId`, `api`, `version`, `tls`, `mode`).
 * Explicitly link-local only: disabled in VPN-only mode or when BITVOID_MDNS_ENABLED=false.
 */
export class DiscoveryService {
  constructor({ config, serverId, logService = null }) {
    this.config = config;
    this.serverId = serverId;
    this.logService = logService;
    this.bonjour = null;
    this.publishedServices = [];
    this.active = false;
  }

  start(actualPort = this.config.port) {
    if (!this.config.mdnsEnabled || this.config.networkMode === "vpn") {
      this.active = false;
      return {
        started: false,
        reason:
          this.config.networkMode === "vpn"
            ? "mDNS is link-local and automatically disabled in VPN mode; configure trusted VPN profiles instead."
            : "mDNS disabled by configuration."
      };
    }

    if (this.active) {
      return { started: true, services: this.getStatus().services };
    }

    const txt = {
      serverId: this.serverId,
      api: "v1",
      version: API_VERSION,
      tls: this.config.tls.enabled ? "1" : "0",
      mode: this.config.networkMode,
      name: this.config.displayName.slice(0, 60)
    };

    try {
      this.bonjour = new Bonjour();
      const primary = this.bonjour.publish({
        name: this.config.displayName || MDNS_CONFIG.DEFAULT_INSTANCE_NAME,
        type: MDNS_CONFIG.PRIMARY_SERVICE_TYPE,
        port: actualPort,
        txt
      });
      const compat = this.bonjour.publish({
        name: `${MDNS_CONFIG.DEFAULT_INSTANCE_NAME} (${this.serverId.slice(0, 10)})`,
        type: MDNS_CONFIG.COMPAT_SERVICE_TYPE,
        port: actualPort,
        txt
      });
      this.publishedServices = [
        { type: `_${MDNS_CONFIG.PRIMARY_SERVICE_TYPE}._tcp`, port: actualPort, handle: primary },
        { type: `_${MDNS_CONFIG.COMPAT_SERVICE_TYPE}._tcp`, port: actualPort, handle: compat }
      ];
      this.active = true;

      if (this.logService) {
        this.logService.write({
          level: "info",
          component: "discovery",
          eventCode: "mdns.started",
          message: `mDNS advertising _${MDNS_CONFIG.PRIMARY_SERVICE_TYPE}._tcp and _${MDNS_CONFIG.COMPAT_SERVICE_TYPE}._tcp on port ${actualPort}`,
          context: { serverId: this.serverId, port: actualPort }
        });
      }

      return { started: true, services: this.getStatus().services };
    } catch (err) {
      this.stop();
      if (this.logService) {
        this.logService.write({
          level: "warn",
          component: "discovery",
          eventCode: "mdns.failed",
          message: `mDNS advertisement unavailable: ${err.message}`
        });
      }
      return { started: false, reason: err.message };
    }
  }

  stop() {
    if (this.bonjour) {
      try {
        this.bonjour.unpublishAll();
      } catch {
        // ignore
      }
      try {
        this.bonjour.destroy();
      } catch {
        // ignore
      }
    }
    this.bonjour = null;
    this.publishedServices = [];
    this.active = false;
  }

  getStatus() {
    return {
      enabled: Boolean(this.config.mdnsEnabled && this.config.networkMode !== "vpn"),
      active: this.active,
      scope: "link-local-only",
      services: this.publishedServices.map((s) => ({ type: s.type, port: s.port }))
    };
  }
}
