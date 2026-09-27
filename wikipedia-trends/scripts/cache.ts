import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";

const DEFAULT_CACHE_DIR = join(import.meta.dirname, "..", "cache");
const DEFAULT_TTL_MS = 24 * 60 * 60 * 1000; // 24h: pageview data is finalized daily by Wikimedia

interface CacheEntry<T> {
  cachedAt: number;
  value: T;
}

function keyToFilename(key: string): string {
  const hash = createHash("sha256").update(key).digest("hex");
  return `${hash}.json`;
}

export class DiskCache {
  private dir: string;
  private ttlMs: number;

  constructor(options: { dir?: string; ttlMs?: number } = {}) {
    this.dir = options.dir ?? DEFAULT_CACHE_DIR;
    this.ttlMs = options.ttlMs ?? DEFAULT_TTL_MS;
    mkdirSync(this.dir, { recursive: true });
  }

  private pathFor(key: string): string {
    return join(this.dir, keyToFilename(key));
  }

  get<T>(key: string): T | undefined {
    const path = this.pathFor(key);
    if (!existsSync(path)) return undefined;
    try {
      const entry = JSON.parse(readFileSync(path, "utf-8")) as CacheEntry<T>;
      if (Date.now() - entry.cachedAt > this.ttlMs) return undefined;
      return entry.value;
    } catch {
      return undefined;
    }
  }

  set<T>(key: string, value: T): void {
    const entry: CacheEntry<T> = { cachedAt: Date.now(), value };
    writeFileSync(this.pathFor(key), JSON.stringify(entry), "utf-8");
  }

  async getOrFetch<T>(key: string, fetcher: () => Promise<T>): Promise<T> {
    const cached = this.get<T>(key);
    if (cached !== undefined) return cached;
    const value = await fetcher();
    this.set(key, value);
    return value;
  }
}
