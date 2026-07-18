import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type {
  CacheManifest,
  CacheStore,
  DocumentCacheEntry,
  NativeAdapter,
  NativeInstance,
  NativePageComplexityStats,
  NativeParseResult,
  NativeScreenshotResult,
  NativeTextItem,
  SourceKind,
} from "../../src/document/tool-types";

export async function makeTempDir(prefix = "parseview-document-test-"): Promise<string> {
  return mkdtemp(path.join(os.tmpdir(), prefix));
}

export function createMemoryCacheStore(): CacheStore & {
  entries: Map<string, DocumentCacheEntry>;
} {
  const entries = new Map<string, DocumentCacheEntry>();
  return {
    entries,
    async get(documentId: string) {
      const entry = entries.get(documentId);
      return entry ? cloneEntry(entry) : undefined;
    },
    async put(entry: DocumentCacheEntry) {
      entries.set(entry.manifest.documentId, cloneEntry(entry));
      return cloneEntry(entry);
    },
    async touch(documentId: string, manifest: CacheManifest) {
      const entry = entries.get(documentId);
      if (entry)
        entry.manifest = {
          ...manifest,
          lastAccessedAt: new Date().toISOString(),
        };
    },
    async delete(documentId: string) {
      entries.delete(documentId);
    },
    async status() {
      let bytes = 0;
      for (const entry of entries.values()) bytes += entry.manifest.cacheBytes;
      return { entryCount: entries.size, bytes };
    },
    async clear() {
      entries.clear();
    },
  };
}

export function createFakeNativeAdapter(
  overrides: Partial<NativeAdapter> & {
    version?: string;
    parse?: (input: string | Buffer) => Promise<NativeParseResult>;
    isComplex?: (input: string | Buffer) => Promise<NativePageComplexityStats[]>;
    screenshot?: (
      input: string | Buffer,
      pageNumbers?: number[] | null,
    ) => Promise<NativeScreenshotResult[]>;
    searchItems?: (
      items: NativeTextItem[],
      options: { phrase: string; caseSensitive?: boolean | null },
    ) => NativeTextItem[];
    create?: (config: Record<string, unknown>) => NativeInstance;
  } = {},
): NativeAdapter {
  const instance: NativeInstance = {
    config: {},
    parse: overrides.parse ?? (async () => ({ pages: [], text: "", images: [] })),
    isComplex: overrides.isComplex ?? (async () => []),
    screenshot: overrides.screenshot ?? (async () => []),
    format: () => "",
  };
  return {
    version: overrides.version ?? "2.6.0",
    create: overrides.create ?? (() => instance),
    searchItems: overrides.searchItems,
  };
}

export function createFakeNativeLoader(adapter: NativeAdapter | Error): {
  load: () => Promise<NativeAdapter>;
  getLastError: () => Error | undefined;
  getLastVersion: () => string | undefined;
} {
  let lastError: Error | undefined;
  let lastVersion: string | undefined;
  return {
    async load() {
      if (adapter instanceof Error) {
        lastError = adapter;
        throw adapter;
      }
      lastVersion = adapter.version;
      return adapter;
    },
    getLastError: () => lastError,
    getLastVersion: () => lastVersion,
  };
}

export async function writeFixtureFile(
  dir: string,
  name: string,
  content: string,
): Promise<string> {
  await mkdir(dir, { recursive: true });
  const file = path.join(dir, name);
  await writeFile(file, content, "utf8");
  return file;
}

export function sourceManifestBase(overrides: Partial<CacheManifest["source"]> = {}) {
  const base: CacheManifest["source"] = {
    inputPath: "./sample.txt",
    resolvedPath: "/tmp/sample.txt",
    realPath: "/tmp/sample.txt",
    size: 10,
    sha256: "a".repeat(64),
    kind: "plain-text" as SourceKind,
    ext: ".txt",
    plainText: true,
  };
  return Object.assign(base, overrides);
}

function cloneEntry(entry: DocumentCacheEntry): DocumentCacheEntry {
  return JSON.parse(JSON.stringify(entry)) as DocumentCacheEntry;
}
