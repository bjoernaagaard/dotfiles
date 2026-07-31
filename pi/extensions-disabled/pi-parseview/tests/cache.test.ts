import { describe, it, expect, beforeEach, afterEach } from "vite-plus/test";
import { Cache, TimedCache } from "../src/cache";
import { mkdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";

describe("Cache", () => {
  const testDir = join(tmpdir(), "pi-content-toolkit-test", randomUUID());
  let cache: Cache;

  beforeEach(async () => {
    await mkdir(testDir, { recursive: true });
    cache = new Cache(testDir);
  });

  afterEach(async () => {
    await rm(testDir, { recursive: true, force: true });
  });

  it("stores and retrieves a value", async () => {
    await cache.set("key1", { name: "test" });
    const result = await cache.get<{ name: string }>("key1");
    expect(result).toEqual({ name: "test" });
  });

  it("returns null for missing keys", async () => {
    const result = await cache.get("nonexistent");
    expect(result).toBeNull();
  });

  it("overwrites existing values", async () => {
    await cache.set("key", { version: 1 });
    await cache.set("key", { version: 2 });
    const result = await cache.get<{ version: number }>("key");
    expect(result).toEqual({ version: 2 });
  });

  it("clears all cached values", async () => {
    await cache.set("a", 1);
    await cache.set("b", 2);
    await cache.clear();
    expect(await cache.get("a")).toBeNull();
    expect(await cache.get("b")).toBeNull();
  });

  it("survives process restart (persists to disk)", async () => {
    await cache.set("persist", "hello");
    // Create a new Cache instance reading the same directory
    const cache2 = new Cache(testDir);
    const result = await cache2.get<string>("persist");
    expect(result).toBe("hello");
  });

  it("handles concurrent set/get operations", async () => {
    const promises = Array.from({ length: 10 }, (_, i) => cache.set(`concurrent-${i}`, i));
    await Promise.all(promises);

    const results = await Promise.all(
      Array.from({ length: 10 }, (_, i) => cache.get<number>(`concurrent-${i}`)),
    );
    expect(results).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
  });
});

describe("TimedCache", () => {
  const ttlDir = join(tmpdir(), "pi-parseview-ttl-test", randomUUID());
  let ttlCache: TimedCache;

  beforeEach(async () => {
    await mkdir(ttlDir, { recursive: true });
    ttlCache = new TimedCache(ttlDir, 10);
  });

  afterEach(async () => {
    await rm(ttlDir, { recursive: true, force: true });
  });

  it("returns stored value within TTL", async () => {
    await ttlCache.set("key", "hello");
    const result = await ttlCache.get<string>("key");
    expect(result).toBe("hello");
  });

  it("returns null for expired entries", async () => {
    const expiredCache = new TimedCache(ttlDir, 0);
    await expiredCache.set("key", "value");
    const result = await expiredCache.get<string>("key");
    expect(result).toBeNull();
  });

  it("returns null for missing keys", async () => {
    const result = await ttlCache.get("nonexistent");
    expect(result).toBeNull();
  });
});
