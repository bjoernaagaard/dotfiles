import { readFile, writeFile, mkdir, rm } from "node:fs/promises";
import { createHash } from "node:crypto";
import { join } from "node:path";

export class Cache {
  constructor(private baseDir: string) {}

  private keyPath(key: string): string {
    const hash = createHash("sha256").update(key).digest("hex").slice(0, 32);
    return join(this.baseDir, hash);
  }

  async get<T>(key: string): Promise<T | null> {
    try {
      const raw = await readFile(this.keyPath(key), "utf-8");
      return JSON.parse(raw) as T;
    } catch {
      return null;
    }
  }

  async set<T>(key: string, data: T): Promise<void> {
    await mkdir(this.baseDir, { recursive: true });
    await writeFile(this.keyPath(key), JSON.stringify(data), "utf-8");
  }

  async clear(): Promise<void> {
    try {
      await rm(this.baseDir, { recursive: true, force: true });
    } catch {
      // ignore if doesn't exist
    }
  }
}

export class TimedCache {
  private store: Cache;

  constructor(
    baseDir: string,
    private ttlSec: number,
  ) {
    this.store = new Cache(baseDir);
  }

  async get<T>(key: string): Promise<T | null> {
    const entry = await this.store.get<{ data: T; ts: number }>(key);
    if (!entry) return null;
    if (this.ttlSec <= 0 || Date.now() - entry.ts > this.ttlSec * 1000) return null;
    return entry.data;
  }

  async set<T>(key: string, data: T): Promise<void> {
    await this.store.set(key, { data, ts: Date.now() });
  }

  async clear(): Promise<void> {
    await this.store.clear();
  }
}

import { getAgentDir } from "@earendil-works/pi-coding-agent";

const CACHE_DIR = join(getAgentDir(), "cache", "parseview", "previews");

export const previewCache = new Cache(CACHE_DIR);
