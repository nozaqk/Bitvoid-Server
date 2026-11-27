#!/usr/bin/env node
import "dotenv/config";
import { createServerInstance } from "./app.js";

let server;
try {
  server = await createServerInstance({ env: process.env });
  const info = await server.start();
  server.app.log.info(
    `BitVoid Server listening on ${server.ctx.config.host}:${info.port} (serverId=${info.serverId}, mDNS=${info.mdns.started ? "active" : "disabled"})`
  );
} catch (err) {
  console.error("Failed to start BitVoid Server:", err.message);
  process.exit(1);
}

let shuttingDown = false;
async function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  server.app.log.info(`Received ${signal}, shutting down BitVoid Server cleanly...`);
  try {
    await server.close();
    process.exit(0);
  } catch (err) {
    console.error("Error during shutdown:", err);
    process.exit(1);
  }
}

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));
