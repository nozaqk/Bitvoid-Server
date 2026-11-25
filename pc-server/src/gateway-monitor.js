const DEFAULT_GATEWAY_URL = "http://192.168.4.1";

function basicAuth(username, password) {
  return "Basic " + Buffer.from(username + ":" + password, "utf8").toString("base64");
}

export function createGatewayMonitor({
  url = process.env.BITVOID_GATEWAY_URL || DEFAULT_GATEWAY_URL,
  username = process.env.BITVOID_GATEWAY_ADMIN_USERNAME || "",
  password = process.env.BITVOID_GATEWAY_ADMIN_PASSWORD || "",
  pcServerId = process.env.BITVOID_PC_SERVER_ID || "bv-pc-server-001",
  pcServerSecret = process.env.BITVOID_PC_SERVER_SECRET || process.env.BITVOID_SYNC_SECRET || "",
  expectedGatewayId = process.env.BITVOID_GATEWAY_ID || "bv-esp12e-gateway-001",
  intervalMs = 10000,
  timeoutMs = 3000
} = {}) {
  const endpoint = new URL("/api/v1/internal/status", url).toString();
  const configured = Boolean(pcServerId && pcServerSecret.length >= 32 && expectedGatewayId);
  let snapshot = {
    configured,
    status: configured ? "checking" : "not-configured",
    endpoint,
    checkedAt: null,
    lastSeenAt: null,
    latencyMs: null,
    telemetry: null,
    error: configured ? "Waiting for first gateway check." : "Set BITVOID_PC_SERVER_ID, BITVOID_PC_SERVER_SECRET (32+ characters), and BITVOID_GATEWAY_ID in the PC server environment."
  };
  let stopped = false;
  let timer = null;
  let checking = false;

  async function check() {
    if (stopped || checking || !configured) return;
    checking = true;
    const started = Date.now();
    try {
      const response = await fetch(endpoint, {
        method: "GET",
        headers: { "X-BitVoid-Server-Id":pcServerId, "X-BitVoid-Server-Key":pcServerSecret, Accept:"application/json" },
        signal: AbortSignal.timeout(timeoutMs),
        cache: "no-store"
      });
      if (!response.ok) {
        const message = response.status === 401
          ? "Gateway rejected the configured dashboard credentials (HTTP 401)."
          : "Gateway returned HTTP " + response.status + ".";
        snapshot = { ...snapshot, status: "offline", checkedAt: new Date().toISOString(), latencyMs: Date.now() - started, error: message };
        return;
      }
      if (response.headers.get("x-bitvoid-server-id") !== expectedGatewayId) throw new Error("ESP gateway identity verification failed.");
      const data = await response.json();
      if (data.status !== "online" || data.gatewayId !== expectedGatewayId || typeof data.uptimeSeconds !== "number") {
        throw new Error("Gateway returned an unexpected status payload.");
      }
      const checkedAt = new Date().toISOString();
      const telemetry = {
        gatewayId: data.gatewayId,
        hostname: data.hostname,
        ssid: data.ssid,
        ip: data.ip,
        mac: data.mac,
        clients: Number(data.clients) || 0,
        maxClients: Number(data.maxClients) || 0,
        uptimeSeconds: data.uptimeSeconds,
        freeHeapBytes: Number(data.freeHeapBytes) || 0,
        chipId: data.chipId,
        flashBytes: Number(data.flashBytes) || 0,
        coreVersion: data.coreVersion
      };
      snapshot = {
        configured: true, status: "online", endpoint, checkedAt, lastSeenAt: checkedAt,
        latencyMs: Date.now() - started, telemetry, error: null
      };
    } catch (error) {
      snapshot = {
        ...snapshot,
        configured: true,
        status: "offline",
        checkedAt: new Date().toISOString(),
        latencyMs: Date.now() - started,
        error: error.name === "TimeoutError" || error.name === "AbortError"
          ? "Gateway did not respond before the " + timeoutMs + " ms timeout."
          : "Gateway check failed: " + String(error.message || error).slice(0, 180)
      };
    } finally {
      checking = false;
    }
  }

  function start() {
    if (timer || !configured) return;
    check();
    timer = setInterval(check, intervalMs);
    timer.unref?.();
  }
  function stop() {
    stopped = true;
    if (timer) clearInterval(timer);
    timer = null;
  }
  return { start, stop, check, getSnapshot: () => ({ ...snapshot, telemetry: snapshot.telemetry ? { ...snapshot.telemetry } : null }) };
}
