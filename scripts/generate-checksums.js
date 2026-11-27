#!/usr/bin/env node
import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { basename, join, resolve } from "node:path";

const artifactsDir = resolve(process.argv[2] || "./dist");
const version = (process.argv[3] || process.env.RELEASE_VERSION || "1.1.0").replace(/^v/, "");
const releaseNotes = process.argv[4] || `BitVoid Server v${version}`;

if (!existsSync(artifactsDir)) {
  console.error(`Artifacts directory not found: ${artifactsDir}`);
  process.exit(1);
}

const files = [];
function collect(dir) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      collect(full);
    } else if (
      entry.isFile() &&
      entry.name !== "SHA256SUMS.txt" &&
      entry.name !== "release-manifest.json"
    ) {
      files.push(full);
    }
  }
}
collect(artifactsDir);

if (files.length === 0) {
  console.error("No release artifacts found to verify.");
  process.exit(1);
}

files.sort();
const checksumLines = [];
const manifestArtifacts = [];

function detectPlatform(filename) {
  const lower = filename.toLowerCase();
  if (lower.endsWith(".exe") || lower.includes("win")) return "windows-x64";
  if (lower.endsWith(".dmg") || lower.includes("macos") || lower.includes("darwin")) return "macos";
  if (lower.endsWith(".deb") || lower.endsWith(".appimage") || lower.endsWith(".rpm") || lower.includes("linux")) {
    return "linux-x64";
  }
  return "generic";
}

for (const filePath of files) {
  const st = statSync(filePath);
  if (st.size === 0) {
    console.error(`Refusing to publish empty artifact: ${filePath}`);
    process.exit(1);
  }
  const buf = readFileSync(filePath);
  const sha256 = createHash("sha256").update(buf).digest("hex");
  const name = basename(filePath);
  checksumLines.push(`${sha256}  ${name}`);
  manifestArtifacts.push({
    filename: name,
    platform: detectPlatform(name),
    sizeBytes: st.size,
    sha256
  });
}

writeFileSync(join(artifactsDir, "SHA256SUMS.txt"), `${checksumLines.join("\n")}\n`, "utf8");
writeFileSync(
  join(artifactsDir, "release-manifest.json"),
  JSON.stringify(
    {
      version,
      publishedAt: new Date().toISOString(),
      releaseNotes,
      artifacts: manifestArtifacts
    },
    null,
    2
  ),
  "utf8"
);

console.log(`Generated SHA256SUMS.txt and release-manifest.json for ${manifestArtifacts.length} verified artifact(s).`);
