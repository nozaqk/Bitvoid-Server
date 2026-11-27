#!/usr/bin/env node
import "dotenv/config";
import { resolveDefaultDataDir, resolveDefaultIpcPath } from "../src/config/env.js";
import { sendAdminIpcRequest } from "../src/ipc/adminIpcClient.js";

const dataDir = resolveDefaultDataDir(process.env);
const ipcPath = resolveDefaultIpcPath(dataDir, process.env);
const authToken = process.env.BITVOID_ADMIN_TOKEN || null;

const [, , cmd, ...args] = process.argv;

function parseFlags(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i += 1) {
    const item = argv[i];
    if (item.startsWith("--")) {
      const key = item.slice(2);
      const next = argv[i + 1];
      if (next && !next.startsWith("--")) {
        out[key] = next;
        i += 1;
      } else {
        out[key] = true;
      }
    }
  }
  return out;
}

const COMMAND_MAP = {
  status: () => ({ method: "admin.status", params: {} }),
  setup: (f) => ({
    method: "admin.setup",
    params: {
      enrollmentCode: f.code,
      username: f.username,
      password: f.password,
      clientInfo: "bitvoid-admin-cli"
    }
  }),
  login: (f) => ({
    method: "admin.login",
    params: { username: f.username, password: f.password, clientInfo: "bitvoid-admin-cli" }
  }),
  overview: () => ({ method: "overview.get", params: {} }),
  nodes: (f) => ({ method: "nodes.list", params: { search: f.search || "", status: f.status || null } }),
  "node-status": (f) => ({
    method: "nodes.setStatus",
    params: { nodeId: f.id, status: f.status, reason: f.reason || null }
  }),
  devices: (f) => ({ method: "devices.list", params: { nodeId: f.node || null } }),
  sessions: (f) => ({ method: "sessions.list", params: { nodeId: f.node || null, status: f.status || "all" } }),
  network: () => ({ method: "network.overview", params: {} }),
  "hotspot-capability": () => ({ method: "network.hotspot.capability", params: {} }),
  logs: (f) => ({ method: "logs.query", params: { level: f.level || null, limit: Number(f.limit || 50) } }),
  audit: (f) => ({ method: "audit.query", params: { limit: Number(f.limit || 50) } }),
  security: () => ({ method: "security.overview", params: {} }),
  backups: () => ({ method: "backups.list", params: {} }),
  "backup-create": (f) => ({ method: "backups.create", params: { passphrase: f.passphrase || null } }),
  "backup-verify": (f) => ({ method: "backups.verify", params: { backupId: f.id, passphrase: f.passphrase || null } }),
  db: () => ({ method: "database.status", params: {} }),
  config: () => ({ method: "config.get", params: {} }),
  updates: () => ({ method: "updates.status", params: {} }),
  shutdown: () => ({ method: "service.shutdown", params: {} })
};

if (!cmd || !COMMAND_MAP[cmd]) {
  console.error(
    `BitVoid Local Administration CLI (IPC: ${ipcPath})\n` +
      `Usage: node bin/bitvoid-admin.js <command> [--flags]\n` +
      `Commands: ${Object.keys(COMMAND_MAP).join(", ")}`
  );
  process.exit(1);
}

try {
  const flags = parseFlags(args);
  const { method, params } = COMMAND_MAP[cmd](flags);
  const result = await sendAdminIpcRequest({ ipcPath, method, params, authToken });
  console.log(JSON.stringify(result, null, 2));
} catch (err) {
  console.error(`Admin IPC error (${err.code || "error"}): ${err.message}`);
  process.exit(1);
}
