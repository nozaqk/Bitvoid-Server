import { existsSync, readFileSync } from "node:fs";
import { SERVER_VERSION } from "../config/constants.js";
import { nowIso, sha256Hex } from "../security/crypto.js";

export function compareSemver(a, b) {
  const parse = (v) =>
    String(v || "0.0.0")
      .replace(/^v/, "")
      .split("-")[0]
      .split(".")
      .map((n) => Number.parseInt(n, 10) || 0);
  const pa = parse(a);
  const pb = parse(b);
  for (let i = 0; i < 3; i += 1) {
    if ((pa[i] || 0) > (pb[i] || 0)) return 1;
    if ((pa[i] || 0) < (pb[i] || 0)) return -1;
  }
  return 0;
}

/**
 * Software Update Verification & Staging Service.
 * Verifies versioned release manifests and SHA-256 artifact checksums offline/locally
 * without making Internet connectivity mandatory for Server operation.
 */
export class UpdateService {
  constructor({ db, auditService = null }) {
    this.db = db;
    this.auditService = auditService;
    this.latestManifest = null;
  }

  getStatus() {
    const installedVersion = SERVER_VERSION;
    const availableVersion = this.latestManifest?.version || null;
    const updateAvailable =
      availableVersion !== null && compareSemver(availableVersion, installedVersion) > 0;

    return {
      installedVersion,
      channel: "stable",
      updateAvailable,
      availableVersion,
      releaseNotes: this.latestManifest?.releaseNotes || null,
      publishedAt: this.latestManifest?.publishedAt || null,
      verifiedArtifacts: this.latestManifest?.artifacts || [],
      checkedAt: this.latestManifest?.checkedAt || null,
      policy:
        "Updates are never applied automatically without checksum/signature verification and explicit administrator confirmation."
    };
  }

  /**
   * Load and validate a release manifest (e.g. imported locally or fetched by the desktop updater).
   */
  loadReleaseManifest(manifest) {
    if (!manifest || typeof manifest !== "object") {
      throw new Error("Release manifest must be a JSON object.");
    }
    if (typeof manifest.version !== "string" || !/^\d+\.\d+\.\d+/.test(manifest.version.replace(/^v/, ""))) {
      throw new Error("Release manifest must declare a valid semantic version.");
    }
    if (!Array.isArray(manifest.artifacts)) {
      throw new Error("Release manifest must include an artifacts list with SHA-256 checksums.");
    }
    for (const art of manifest.artifacts) {
      if (!art.filename || !/^[0-9a-fA-F]{64}$/.test(art.sha256 || "")) {
        throw new Error(`Artifact "${art?.filename || "unknown"}" is missing a valid SHA-256 digest.`);
      }
    }

    this.latestManifest = {
      version: manifest.version.replace(/^v/, ""),
      releaseNotes: String(manifest.releaseNotes || ""),
      publishedAt: manifest.publishedAt || null,
      artifacts: manifest.artifacts.map((a) => ({
        filename: a.filename,
        platform: a.platform || "unknown",
        sha256: a.sha256.toLowerCase(),
        sizeBytes: Number(a.sizeBytes) || 0
      })),
      checkedAt: nowIso()
    };
    return this.getStatus();
  }

  verifyArtifactFile(filePath, expectedSha256) {
    if (!existsSync(filePath)) {
      throw new Error(`Update artifact not found: ${filePath}`);
    }
    if (!/^[0-9a-fA-F]{64}$/.test(expectedSha256 || "")) {
      throw new Error("Expected SHA-256 digest must be 64 hexadecimal characters.");
    }
    const buf = readFileSync(filePath);
    const actual = sha256Hex(buf);
    const valid = actual === expectedSha256.toLowerCase();

    if (this.auditService) {
      this.auditService.record({
        actorType: "admin",
        actorId: "updater",
        action: "update.artifact.verify",
        targetType: "file",
        targetId: filePath,
        outcome: valid ? "success" : "failure",
        details: { actualSha256: actual, expectedSha256: expectedSha256.toLowerCase() }
      });
    }

    return { ok: valid, actualSha256: actual, expectedSha256: expectedSha256.toLowerCase(), sizeBytes: buf.length };
  }
}
