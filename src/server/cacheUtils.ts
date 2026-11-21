export interface TimedCacheEntry<T> {
  expiresAt: number;
  staleUntil: number;
  value: T;
}

export class TimedLruCache<T = unknown> {
  private readonly store = new Map<string, TimedCacheEntry<T>>();
  private readonly maxEntries: number;

  constructor(maxEntries = 1_000) {
    this.maxEntries = Math.max(16, maxEntries);
  }

  get(key: string): T | null {
    const entry = this.store.get(key);
    if (!entry) return null;
    const now = Date.now();
    if (now > entry.expiresAt) {
      if (now > entry.staleUntil) {
        this.store.delete(key);
      }
      return null;
    }
    // Refresh LRU order
    this.store.delete(key);
    this.store.set(key, entry);
    return entry.value;
  }

  getStale(key: string): T | null {
    const entry = this.store.get(key);
    if (!entry) return null;
    if (Date.now() > entry.staleUntil) {
      this.store.delete(key);
      return null;
    }
    return entry.value;
  }

  set(key: string, value: T, ttlMs: number, staleTtlMs = 0): T {
    if (this.store.has(key)) {
      this.store.delete(key);
    } else if (this.store.size >= this.maxEntries) {
      const oldestKey = this.store.keys().next().value;
      if (oldestKey !== undefined) {
        this.store.delete(oldestKey);
      }
    }
    const now = Date.now();
    this.store.set(key, {
      expiresAt: now + Math.max(0, ttlMs),
      staleUntil: now + Math.max(ttlMs, staleTtlMs),
      value,
    });
    return value;
  }

  delete(key: string): boolean {
    return this.store.delete(key);
  }

  deleteByPrefix(prefix: string): number {
    let removed = 0;
    for (const key of this.store.keys()) {
      if (key.startsWith(prefix)) {
        this.store.delete(key);
        removed += 1;
      }
    }
    return removed;
  }

  clear(): void {
    this.store.clear();
  }

  get size(): number {
    return this.store.size;
  }
}

export class InFlightCoalescer {
  private readonly pending = new Map<string, Promise<unknown>>();

  run<T>(key: string, fn: () => Promise<T>): Promise<T> {
    const existing = this.pending.get(key) as Promise<T> | undefined;
    if (existing) return existing;

    const promise = (async () => {
      try {
        return await fn();
      } finally {
        this.pending.delete(key);
      }
    })();

    this.pending.set(key, promise);
    return promise;
  }

  get activeCount(): number {
    return this.pending.size;
  }
}
