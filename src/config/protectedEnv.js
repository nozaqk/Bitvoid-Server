import { config as loadDotenv } from "dotenv";
import { existsSync } from "node:fs";
import { win32 } from "node:path";

/**
 * Resolve the protected environment file for this process.
 *
 * Order: an explicit DOTENV_CONFIG_PATH, then BITVOID_ENV_FILE, then (on Windows only)
 * server.env inside the protected ProgramData data directory the installer creates.
 * Returns null when no protected file applies (for example Linux, where systemd's
 * EnvironmentFile supplies the variables).
 */
export function resolveProtectedEnvFile(env = process.env, platform = process.platform) {
  if (env.DOTENV_CONFIG_PATH) return env.DOTENV_CONFIG_PATH;
  if (env.BITVOID_ENV_FILE) return env.BITVOID_ENV_FILE;
  if (platform === "win32") {
    const base = env.ProgramData || env.PROGRAMDATA || "C:\\ProgramData";
    return win32.join(base, "BitVoidServer", "server.env");
  }
  return null;
}

/**
 * Load the protected environment file into process.env without overriding values that are
 * already set, so explicit service or shell configuration always wins.
 */
export function loadProtectedEnv(env = process.env, platform = process.platform) {
  const file = resolveProtectedEnvFile(env, platform);
  if (!file) return { path: null, loaded: false };
  if (!existsSync(file)) return { path: file, loaded: false };
  const result = loadDotenv({ path: file, override: false, quiet: true });
  return { path: file, loaded: !result.error };
}

// Load eagerly when imported by the Server entry point, before any module reads configuration.
const startup = loadProtectedEnv();
export const protectedEnvStatus = startup;

