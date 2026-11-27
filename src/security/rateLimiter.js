/**
 * Sliding-window key-based rate limiter (e.g. by normalized username or recovery action)
 * that complements IP-based rate limiting and mitigates distributed multi-IP brute-force attacks.
 */
export class KeyedRateLimiter {
  constructor({ maxAttempts = 10, windowMs = 15 * 60 * 1000, lockoutMs = 15 * 60 * 1000 } = {}) {
    this.maxAttempts = maxAttempts;
    this.windowMs = windowMs;
    this.lockoutMs = lockoutMs;
    this.buckets = new Map();
  }

  _prune(now = Date.now()) {
    for (const [key, entry] of this.buckets.entries()) {
      const validTimestamps = entry.attempts.filter((ts) => now - ts < this.windowMs);
      if (validTimestamps.length === 0 && (!entry.lockedUntil || entry.lockedUntil <= now)) {
        this.buckets.delete(key);
      } else {
        entry.attempts = validTimestamps;
      }
    }
  }

  check(key, now = Date.now()) {
    const entry = this.buckets.get(key);
    if (!entry) {
      return { allowed: true, remaining: this.maxAttempts, retryAfterMs: 0 };
    }
    if (entry.lockedUntil && entry.lockedUntil > now) {
      return {
        allowed: false,
        remaining: 0,
        retryAfterMs: entry.lockedUntil - now
      };
    }
    entry.attempts = entry.attempts.filter((ts) => now - ts < this.windowMs);
    const remaining = Math.max(0, this.maxAttempts - entry.attempts.length);
    return {
      allowed: remaining > 0,
      remaining,
      retryAfterMs: remaining > 0 ? 0 : this.lockoutMs
    };
  }

  recordFailure(key, now = Date.now()) {
    if (this.buckets.size > 5000) {
      this._prune(now);
    }
    let entry = this.buckets.get(key);
    if (!entry) {
      entry = { attempts: [], lockedUntil: 0 };
      this.buckets.set(key, entry);
    }
    entry.attempts = entry.attempts.filter((ts) => now - ts < this.windowMs);
    entry.attempts.push(now);
    if (entry.attempts.length >= this.maxAttempts) {
      entry.lockedUntil = now + this.lockoutMs;
    }
    return {
      attempts: entry.attempts.length,
      locked: Boolean(entry.lockedUntil && entry.lockedUntil > now),
      retryAfterMs: entry.lockedUntil > now ? entry.lockedUntil - now : 0
    };
  }

  recordSuccess(key) {
    this.buckets.delete(key);
  }

  snapshotStats(now = Date.now()) {
    this._prune(now);
    let lockedCount = 0;
    for (const entry of this.buckets.values()) {
      if (entry.lockedUntil && entry.lockedUntil > now) lockedCount += 1;
    }
    return {
      trackedKeys: this.buckets.size,
      lockedKeys: lockedCount
    };
  }

  clear() {
    this.buckets.clear();
  }
}
