import { existsSync, readFileSync } from "node:fs";
import { inspectCertificatePem } from "../security/crypto.js";

export function loadTlsContext(tlsConfig) {
  if (!tlsConfig || !tlsConfig.enabled) {
    return {
      enabled: false,
      fastifyHttps: undefined,
      certificateInfo: null,
      warning:
        "TLS is disabled (HTTP/WS). Suitable only for trusted private LANs; enable TLS before using untrusted networks, VPNs, or central hosting."
    };
  }

  if (!existsSync(tlsConfig.certPath)) {
    throw new Error(`TLS certificate file not found: ${tlsConfig.certPath}`);
  }
  if (!existsSync(tlsConfig.keyPath)) {
    throw new Error(`TLS private key file not found: ${tlsConfig.keyPath}`);
  }

  const cert = readFileSync(tlsConfig.certPath);
  const key = readFileSync(tlsConfig.keyPath);
  const ca = tlsConfig.caPath && existsSync(tlsConfig.caPath) ? readFileSync(tlsConfig.caPath) : undefined;

  let certificateInfo = null;
  let expiryWarning = null;
  try {
    certificateInfo = inspectCertificatePem(cert);
    const validToMs = Date.parse(certificateInfo.validTo);
    const daysRemaining = Math.floor((validToMs - Date.now()) / (24 * 60 * 60 * 1000));
    certificateInfo.daysRemaining = daysRemaining;
    if (daysRemaining <= 0) {
      expiryWarning = "TLS certificate has expired.";
    } else if (daysRemaining <= 30) {
      expiryWarning = `TLS certificate expires in ${daysRemaining} day(s).`;
    }
  } catch (err) {
    throw new Error(`Invalid TLS certificate PEM at ${tlsConfig.certPath}: ${err.message}`);
  }

  return {
    enabled: true,
    fastifyHttps: { cert, key, ...(ca ? { ca } : {}) },
    certificateInfo,
    warning: expiryWarning
  };
}
