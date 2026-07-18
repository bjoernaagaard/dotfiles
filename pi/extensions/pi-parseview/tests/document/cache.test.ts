import { createHash } from "node:crypto";
import { lstat, mkdir, readFile, readdir, writeFile, symlink, stat } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { describe, it, expect } from "vite-plus/test";
import { createFilesystemCacheStore } from "../../src/document/cache";
import type { CacheManifest, DocumentCacheEntry } from "../../src/document/tool-types";

function makeEntry(documentId: string, label: string): DocumentCacheEntry {
  const text = `${label}\n`.repeat(20);
  const digest = createHash("sha256").update(label).digest("hex");
  const pages = [
    {
      pageNum: 1,
      width: 100,
      height: 100,
      text,
      lines: [
        {
          lineNumber: 1,
          pageNum: 1,
          pageLineNumber: 1,
          text: label,
          startOffset: 0,
          endOffset: label.length,
        },
      ],
      textItems: [{ text: label, x: 0, y: 0, width: 10, height: 10 }],
    },
  ];
  const textItems = [
    {
      pageNum: 1,
      textItems: [{ text: label, x: 0, y: 0, width: 10, height: 10 }],
    },
  ];
  const manifest: CacheManifest = {
    schemaVersion: 1,
    documentId,
    cacheKey: label,
    cacheKeyHash: digest,
    source: {
      inputPath: "./sample.txt",
      resolvedPath: `/tmp/${label}.txt`,
      realPath: `/tmp/${label}.txt`,
      size: text.length,
      sha256: digest,
      kind: "plain-text",
      ext: ".txt",
      plainText: true,
    },
    createdAt: new Date().toISOString(),
    lastAccessedAt: new Date().toISOString(),
    packageVersion: "2.6.0",
    sourceHash: digest,
    pageCount: 1,
    redactedConfig: {
      format: "text",
      ocrModeRequested: "off",
      ocrModeResolved: "off",
      ocrLanguage: "eng",
    },
    artifacts: {
      documentText: { path: "document.txt", bytes: text.length },
      pages: { path: "pages.json.gz", bytes: 1 },
      textItems: { path: "textitems.json.gz", bytes: 1 },
      images: {},
      screenshots: {},
    },
    cacheBytes: 0,
  };
  return { manifest, documentText: text, pages, textItems };
}

describe("document filesystem cache", () => {
  it("stores and reads cache entries atomically", async () => {
    const root = await mkRoot();
    const store = createFilesystemCacheStore(root, {
      maxDocumentCacheBytes: 1_000_000,
      maxTotalCacheBytes: 2_000_000,
    });
    const entry = makeEntry("aaaaaaaaaaaaaaaaaaaaaaaa", "alpha");
    await store.put(entry);
    const loaded = await store.get(entry.manifest.documentId);
    expect(loaded?.documentText).toContain("alpha");
    expect(loaded?.manifest.documentId).toBe(entry.manifest.documentId);
    const status = await store.status();
    expect(status.bytes).toBe(await treeBytes(path.join(root, entry.manifest.documentId)));
  });

  it("drops corrupt entries", async () => {
    const root = await mkRoot();
    const store = createFilesystemCacheStore(root, {
      maxDocumentCacheBytes: 1_000_000,
      maxTotalCacheBytes: 2_000_000,
    });
    const id = "bbbbbbbbbbbbbbbbbbbbbbbb";
    const dir = path.join(root, id);
    await mkdir(dir, { recursive: true });
    await writeFile(path.join(dir, "manifest.json"), "not json", "utf8");
    const loaded = await store.get(id);
    expect(loaded).toBeUndefined();
    await expect(stat(dir)).rejects.toThrow();
  });

  it("evicts least-recently-accessed entries when total quota is exceeded", async () => {
    const root = await mkRoot();
    const store = createFilesystemCacheStore(root, {
      maxDocumentCacheBytes: 3_000,
      maxTotalCacheBytes: 5_000,
    });
    await store.put(makeEntry("aaaaaaaaaaaaaaaaaaaaaaaa", "a"));
    await new Promise((r) => setTimeout(r, 2));
    await store.put(makeEntry("bbbbbbbbbbbbbbbbbbbbbbbb", "b"));
    await new Promise((r) => setTimeout(r, 2));
    await store.get("aaaaaaaaaaaaaaaaaaaaaaaa");
    await store.put(makeEntry("cccccccccccccccccccccccc", "c"));
    const status = await store.status();
    expect(status.bytes).toBeLessThanOrEqual(5_000);
    expect(status.entryCount).toBeLessThanOrEqual(3);
  });

  it("rejects documents over the per-document quota without replacing a valid entry", async () => {
    const root = await mkRoot();
    const store = createFilesystemCacheStore(root, {
      maxDocumentCacheBytes: 500,
      maxTotalCacheBytes: 2_000,
    });
    const entry = makeEntry("eeeeeeeeeeeeeeeeeeeeeeee", "oversized");
    await expect(store.put(entry)).rejects.toThrow(/Document cache quota exceeded/);
    expect(await store.get(entry.manifest.documentId)).toBeUndefined();
  });

  it("purges a syntactically valid manifest missing required provenance", async () => {
    const root = await mkRoot();
    const store = createFilesystemCacheStore(root, {
      maxDocumentCacheBytes: 1_000_000,
      maxTotalCacheBytes: 2_000_000,
    });
    const entry = makeEntry("abababababababababababab", "manifest");
    await store.put(entry);
    const manifestPath = path.join(root, entry.manifest.documentId, "manifest.json");
    const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
    delete (manifest as any).redactedConfig;
    delete (manifest as any).source.plainText;
    await writeFile(manifestPath, JSON.stringify(manifest), "utf8");
    expect(await store.get(entry.manifest.documentId)).toBeUndefined();
    await expect(stat(path.join(root, entry.manifest.documentId))).rejects.toThrow();
  });

  it("purges an entry whose artifact bytes no longer match its manifest", async () => {
    const root = await mkRoot();
    const store = createFilesystemCacheStore(root, {
      maxDocumentCacheBytes: 1_000_000,
      maxTotalCacheBytes: 2_000_000,
    });
    const entry = makeEntry("ffffffffffffffffffffffff", "integrity");
    await store.put(entry);
    await writeFile(path.join(root, entry.manifest.documentId, "document.txt"), "tampered", "utf8");
    expect(await store.get(entry.manifest.documentId)).toBeUndefined();
    await expect(stat(path.join(root, entry.manifest.documentId))).rejects.toThrow();
  });

  it("rejects a symlink cache root", async () => {
    const external = await mkRoot();
    const parent = await mkRoot();
    const root = path.join(parent, "cache-link");
    await symlink(external, root);
    const store = createFilesystemCacheStore(root, {
      maxDocumentCacheBytes: 1_000_000,
      maxTotalCacheBytes: 2_000_000,
    });
    await expect(store.status()).rejects.toThrow(/must not be a symlink/);
  });

  it("does not follow symlinks while deleting cache entries", async () => {
    const root = await mkRoot();
    const externalDir = await mkRoot();
    const externalFile = path.join(externalDir, "keep.txt");
    await writeFile(externalFile, "keep me", "utf8");
    const store = createFilesystemCacheStore(root, {
      maxDocumentCacheBytes: 1_000_000,
      maxTotalCacheBytes: 2_000_000,
    });
    const entry = makeEntry("dddddddddddddddddddddddd", "delta");
    await store.put(entry);
    const docDir = path.join(root, entry.manifest.documentId);
    await symlink(externalFile, path.join(docDir, "screenshots-link.png"));
    await store.clear();
    await expect(readFile(externalFile, "utf8")).resolves.toBe("keep me");
  });
});

async function treeBytes(target: string): Promise<number> {
  const item = await lstat(target);
  if (!item.isDirectory() || item.isSymbolicLink()) return item.size;
  let total = 0;
  for (const child of await readdir(target)) {
    total += await treeBytes(path.join(target, child));
  }
  return total;
}

async function mkRoot(): Promise<string> {
  const dir = path.join(
    os.tmpdir(),
    `parseview-cache-${Date.now()}-${Math.random().toString(16).slice(2)}`,
  );
  await mkdir(dir, { recursive: true });
  return dir;
}
