import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  statSync,
  unlinkSync
} from "node:fs";
import { join } from "node:path";
import { nowIso } from "../security/crypto.js";
import { redactValue } from "../security/redaction.js";

const LEVELS = Object.freeze({
  debug: 10,
  info: 20,
  warn: 30,
  error: 40
});

/**
 * Structured redacted JSON-lines logger with bounded file rotation and fast ring buffer for dashboard queries.
 */
export class LogService {
  constructor({
    logDir,
    filename = "bitvoid-server.log",
    maxFileBytes = 5 * 1024 * 1024,
    maxRotatedFiles = 5,
    ringBufferSize = 1000,
    minLevel = "info",
    persistToDisk = true
  } = {}) {
    this.logDir = logDir;
    this.filename = filename;
    this.filePath = logDir ? join(logDir, filename) : null;
    this.maxFileBytes = maxFileBytes;
    this.maxRotatedFiles = maxRotatedFiles;
    this.ringBufferSize = ringBufferSize;
    this.minLevelRank = LEVELS[minLevel] || LEVELS.info;
    this.persistToDisk = Boolean(persistToDisk && logDir);
    this.ring = [];

    if (this.persistToDisk) {
      mkdirSync(logDir, { recursive: true, mode: 0o700 });
    }
  }

  _rotateIfNeeded() {
    if (!this.persistToDisk || !this.filePath || !existsSync(this.filePath)) return;
    let size = 0;
    try {
      size = statSync(this.filePath).size;
    } catch {
      return;
    }
    if (size < this.maxFileBytes) return;

    // Delete oldest rotated file and shift others up.
    for (let i = this.maxRotatedFiles; i >= 1; i -= 1) {
      const src = i === 1 ? this.filePath : `${this.filePath}.${i - 1}`;
      const dst = `${this.filePath}.${i}`;
      if (i === this.maxRotatedFiles && existsSync(dst)) {
        try {
          unlinkSync(dst);
        } catch {
          // ignore
        }
      }
      if (existsSync(src)) {
        try {
          renameSync(src, dst);
        } catch {
          // ignore
        }
      }
    }
  }

  write({ level = "info", component = "server", eventCode = "log", requestId = null, message = "", context = null }) {
    const rank = LEVELS[level] || LEVELS.info;
    if (rank < this.minLevelRank) return null;

    const entry = {
      timestamp: nowIso(),
      level,
      component,
      eventCode,
      requestId,
      message: redactValue(String(message)),
      context: context ? redactValue(context) : undefined
    };

    this.ring.push(entry);
    if (this.ring.length > this.ringBufferSize) {
      this.ring.shift();
    }

    if (this.persistToDisk && this.filePath) {
      try {
        this._rotateIfNeeded();
        appendFileSync(this.filePath, `${JSON.stringify(entry)}\n`, { encoding: "utf8", mode: 0o600 });
      } catch {
        // Do not crash server on disk log error
      }
    }

    return entry;
  }

  query({ level, component, search, limit = 100 } = {}) {
    const minRank = level && LEVELS[level] ? LEVELS[level] : 0;
    const needle = search ? String(search).toLowerCase() : null;
    const maxItems = Math.min(Math.max(Number(limit) || 100, 1), 1000);

    const results = [];
    for (let i = this.ring.length - 1; i >= 0 && results.length < maxItems; i -= 1) {
      const entry = this.ring[i];
      if (minRank && (LEVELS[entry.level] || 0) < minRank) continue;
      if (component && entry.component !== component) continue;
      if (needle) {
        const hay = `${entry.message} ${entry.eventCode} ${entry.component} ${JSON.stringify(entry.context || "")}`.toLowerCase();
        if (!hay.includes(needle)) continue;
      }
      results.push(entry);
    }
    return results;
  }

  readFromDiskTail(maxLines = 200) {
    if (!this.filePath || !existsSync(this.filePath)) return [];
    const raw = readFileSync(this.filePath, "utf8");
    const lines = raw.trim().split("\n").filter(Boolean);
    return lines.slice(-maxLines).map((line) => {
      try {
        return JSON.parse(line);
      } catch {
        return { raw: line };
      }
    });
  }

  getRotationStatus() {
    if (!this.persistToDisk || !this.logDir || !existsSync(this.logDir)) {
      return { enabled: false, totalDiskBytes: 0, files: [] };
    }
    const entries = readdirSync(this.logDir)
      .filter((name) => name.startsWith(this.filename))
      .map((name) => {
        const fullPath = join(this.logDir, name);
        const st = statSync(fullPath);
        return { name, sizeBytes: st.size, modifiedAt: st.mtime.toISOString() };
      });
    const totalDiskBytes = entries.reduce((sum, f) => sum + f.sizeBytes, 0);
    return {
      enabled: true,
      logDir: this.logDir,
      maxFileBytes: this.maxFileBytes,
      maxRotatedFiles: this.maxRotatedFiles,
      totalDiskBytes,
      files: entries
    };
  }
}
