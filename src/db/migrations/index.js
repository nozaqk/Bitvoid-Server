import m001 from "./001_initial_schema.js";
import m002 from "./002_nodes_devices_sessions.js";
import m003 from "./003_security_admin_ops.js";
import m004 from "./004_messaging_sync.js";

export const MIGRATIONS = Object.freeze([m001, m002, m003, m004]);
