import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { describe, it, expect } from "vite-plus/test";
import { createFilesystemCacheStore } from "../../src/document/cache";
import {
  buildCacheKey,
  buildDocumentId,
  createLiteparseService,
  classifySourceKind,
  resolveParseSettings,
  resolveSource,
} from "../../src/document/parser";
import type {
  NativePageComplexityStats,
  NativeParseResult,
  NativeTextItem,
  ResolvedConfig,
} from "../../src/document/tool-types";
import { formatParseResult } from "../../src/document/tools/parse";
import { sha256Hex } from "../../src/document/utils";
import {
  createFakeNativeAdapter,
  createFakeNativeLoader,
  createMemoryCacheStore,
  makeTempDir,
  writeFixtureFile,
} from "./test-helpers";

function baseConfig(cacheDir: string, packageVersion = "2.6.0"): ResolvedConfig {
  return {
    cacheDir,
    cacheDirRealPath: cacheDir,
    packageVersion,
    maxInputBytes: 10_000_000,
    maxPages: 50,
    maxDpi: 300,
    defaultDpi: 150,
    maxScreenshots: 4,
    maxOutputBytes: 20_480,
    maxSearchResults: 20,
    maxDocumentCacheBytes: 500_000_000,
    maxTotalCacheBytes: 2_000_000_000,
    ocrMode: "auto",
    ocrLanguage: "eng",
    ocrFailureFatal: true,
    ocrHedgeDelaysMs: [],
    secrets: { fingerprint: "f".repeat(64) },
  };
}

function makeParseResult(texts: string[]): NativeParseResult {
  return {
    pages: texts.map((text, pageIndex) => ({
      pageNum: pageIndex + 1,
      width: 800,
      height: 1000,
      text,
      textItems: text
        .split(/\s+/)
        .filter(Boolean)
        .map(
          (word, wordIndex) =>
            ({
              text: word,
              x: 10 + wordIndex * 30,
              y: 20,
              width: Math.max(8, word.length * 8),
              height: 12,
              confidence: 0.9,
            }) as NativeTextItem,
        ),
    })),
    text: texts.join("\n"),
    images: [],
  };
}

function makeComplexity(needsOcr: boolean): NativePageComplexityStats[] {
  return [
    {
      pageNumber: 1,
      textLength: 12,
      textCoverage: 0.2,
      hasSubstantialImages: needsOcr,
      imageBlockCount: needsOcr ? 1 : 0,
      imageCoverage: needsOcr ? 0.6 : 0.1,
      largestImageCoverage: needsOcr ? 0.6 : 0.1,
      fullPageImage: needsOcr,
      uncoveredVectorArea: 0,
      isGarbled: false,
      pageArea: 1000,
      needsOcr,
      reasons: needsOcr ? ["image-heavy"] : [],
    },
  ];
}

describe("document parser/service", () => {
  it("classifies sources and validates local paths", async () => {
    expect(classifySourceKind(".txt")).toBe("plain-text");
    expect(classifySourceKind(".pdf")).toBe("pdf");
    expect(classifySourceKind(".key")).toBe("presentation");
    expect(classifySourceKind(".unknown")).toBe("unsupported");

    const dir = await makeTempDir();
    await writeFixtureFile(dir, "sample.txt", "hello");
    const source = await resolveSource("./sample.txt", dir, 1000);
    expect(path.basename(source.realPath)).toBe("sample.txt");
    expect(source.realPath).toContain(dir);
    expect(source.kind).toBe("plain-text");
    expect(source.size).toBe(5);
    await expect(resolveSource("./missing.pdf", dir, 1000)).rejects.toThrow();
    await expect(resolveSource("https://example.com/doc.pdf", dir, 1000)).rejects.toThrow(
      /local filesystem/i,
    );
  });

  it("builds deterministic cache keys and invalidates on inputs", async () => {
    const dir = await makeTempDir();
    const source = {
      inputPath: "./doc.pdf",
      cwd: dir,
      resolvedPath: "/tmp/doc.pdf",
      realPath: "/tmp/doc.pdf",
      size: 5,
      sha256: sha256Hex("alpha"),
      ext: ".pdf",
      kind: "pdf" as const,
      plainText: false,
    };
    const config = baseConfig(dir, "2.6.0");
    const settings = resolveParseSettings(config, {
      path: "./doc.pdf",
      ocrMode: "off",
      dpi: 150,
      format: "text",
    });

    const key1 = buildCacheKey(config, source, settings);
    const key2 = buildCacheKey(config, source, settings);
    expect(key1).toEqual(key2);
    expect(buildDocumentId(key1.cacheKeyHash)).toMatch(/^[0-9a-f]{24}$/);

    expect(
      buildCacheKey({ ...config, packageVersion: "3.0.0" }, source, settings).cacheKeyHash,
    ).not.toBe(key1.cacheKeyHash);

    expect(
      buildCacheKey(config, { ...source, sha256: sha256Hex("beta"), size: 4 }, settings)
        .cacheKeyHash,
    ).not.toBe(key1.cacheKeyHash);
  });

  it("parses plain text without loading native, caches it, and supports read query", async () => {
    const dir = await makeTempDir();
    await writeFixtureFile(dir, "notes.txt", "alpha\nbeta needle\n\u03b3amma");
    const cache = createMemoryCacheStore();

    const service = createLiteparseService({
      config: baseConfig(dir),
      cache,
      nativeLoader: createFakeNativeLoader(
        createFakeNativeAdapter({
          searchItems: () => [],
          isComplex: async () => [],
          parse: async () => makeParseResult(["alpha", "beta"]),
        }),
      ),
    });

    const parsed = await service.parse({ path: "./notes.txt" }, { cwd: dir });
    expect(parsed.cacheHit).toBe(false);
    expect(parsed.manifest.source.plainText).toBe(true);
    expect(parsed.pages).toHaveLength(1);
    expect(parsed.ocrModeResolved).toBe("off");

    const cached = await service.parse({ path: "./notes.txt" }, { cwd: dir });
    expect(cached.cacheHit).toBe(true);

    const readPage = await service.read(
      { action: "read", documentId: parsed.documentId, page: 1 },
      { cwd: dir },
    );
    expect(readPage.text).toContain("alpha");
    expect(readPage.lines).toHaveLength(3);

    const readWindow = await service.read(
      {
        action: "read",
        documentId: parsed.documentId,
        startLine: 2,
        lineCount: 1,
      },
      { cwd: dir },
    );
    expect(readWindow.text).toContain("2: beta needle");
  });

  it("retains complete requested reads when the configured byte ceiling truncates output", async () => {
    const dir = await makeTempDir();
    const cache = createMemoryCacheStore();
    const lines = Array.from({ length: 40 }, (_, index) => `${index + 1}-${"x".repeat(80)}`);
    await writeFixtureFile(dir, "large.txt", lines.join("\n"));
    const config = { ...baseConfig(dir), maxOutputBytes: 200 };
    const service = createLiteparseService({
      config,
      cache,
      nativeLoader: createFakeNativeLoader(new Error("native should not load")),
    });

    const parsed = await service.parse({ path: "./large.txt" }, { cwd: dir });
    const result = await service.read(
      { action: "read", documentId: parsed.documentId, startLine: 1, lineCount: 40 },
      { cwd: dir },
    );
    const expected = lines.map((line, index) => `${index + 1}: ${line}`).join("\n");

    expect(result.truncated).toBe(true);
    expect(result.text).not.toBe(expected);
    expect(result.completeText).toBe(expected);
    expect(result.lines).toHaveLength(40);
  });

  it("preserves formatted JSON output in the cache", async () => {
    const dir = await makeTempDir();
    const cache = createMemoryCacheStore();
    const jsonOutput = JSON.stringify({ pages: [{ pageNum: 1, text: "alpha" }] });
    const nativeResult = makeParseResult(["alpha"]);
    nativeResult.text = jsonOutput;
    const service = createLiteparseService({
      config: baseConfig(dir),
      cache,
      nativeLoader: createFakeNativeLoader(
        createFakeNativeAdapter({
          searchItems: () => [],
          isComplex: async () => makeComplexity(false),
          parse: async () => nativeResult,
        }),
      ),
    });

    await writeFixtureFile(dir, "doc.pdf", "fixture");
    const parsed = await service.parse(
      { path: "./doc.pdf", format: "json", ocrMode: "off" },
      { cwd: dir },
    );
    expect(parsed.documentJson).toBe(jsonOutput);
    const formatted = await formatParseResult(parsed, "json");
    expect(formatted.content[0].text).toBe(jsonOutput);
    expect(formatted.details).toMatchObject({
      file: parsed.manifest.source.realPath,
      pages: "all",
      pagesParsed: 1,
    });

    const cached = await service.parse(
      { path: "./doc.pdf", format: "json", ocrMode: "off" },
      { cwd: dir },
    );
    expect(cached.cacheHit).toBe(true);
    expect(cached.documentJson).toBe(jsonOutput);
  });

  it("renders screenshots, returns model images, and preserves prior screenshot artifacts", async () => {
    const dir = await makeTempDir();
    const config = baseConfig(path.join(dir, "cache"));
    const cache = createFilesystemCacheStore(config.cacheDir, {
      maxDocumentCacheBytes: config.maxDocumentCacheBytes,
      maxTotalCacheBytes: config.maxTotalCacheBytes,
    });
    const adapter = createFakeNativeAdapter({
      searchItems: () => [],
      isComplex: async () => makeComplexity(false),
      parse: async () => makeParseResult(["page one", "page two"]),
      screenshot: async (_input, pages) =>
        (pages ?? []).map((pageNum) => ({
          pageNum,
          imageBuffer: Buffer.from(`png-${pageNum}`),
          width: 800,
          height: 1000,
        })),
    });
    const service = createLiteparseService({
      config,
      cache,
      nativeLoader: createFakeNativeLoader(adapter),
    });

    const sourcePath = await writeFixtureFile(dir, "doc.pdf", "fixture");
    const parsed = await service.parse(
      { path: sourcePath, format: "text", ocrMode: "off" },
      { cwd: dir },
    );
    const first = await service.screenshot(
      { documentId: parsed.documentId, pages: [1], includeImages: true },
      { cwd: dir, model: { input: ["text", "image"] } as any },
    );
    expect(first.images?.[0]).toMatchObject({ type: "image", mimeType: "image/png" });
    await expect(readFile(first.pages[0].path, "utf8")).resolves.toBe("png-1");

    const second = await service.screenshot(
      { documentId: parsed.documentId, pages: [2], includeImages: false },
      { cwd: dir },
    );
    expect(second.images).toBeUndefined();
    await expect(readFile(second.pages[0].path, "utf8")).resolves.toBe("png-2");
    const cached = await cache.get(parsed.documentId);
    expect(Object.keys(cached!.manifest.artifacts.screenshots)).toEqual([
      "page-2-150",
      "page-1-150",
    ]);

    await writeFile(sourcePath, "changed", "utf8");
    await expect(
      service.screenshot({ documentId: parsed.documentId, pages: [1] }, { cwd: dir }),
    ).rejects.toThrow(/changed since cache entry/);
  });

  it("supports search via native adapter and validates input", async () => {
    const dir = await makeTempDir();
    const cache = createMemoryCacheStore();
    const adapter = createFakeNativeAdapter({
      searchItems: (items, { phrase }) => items.filter((item) => item.text.includes(phrase)),
      isComplex: async () => makeComplexity(false),
      parse: async () => makeParseResult(["alpha", "needle beta"]),
    });

    const service = createLiteparseService({
      config: baseConfig(dir),
      cache,
      nativeLoader: createFakeNativeLoader(adapter),
    });

    await writeFixtureFile(dir, "doc.pdf", "alpha\nneedle beta");
    const parsed = await service.parse(
      { path: "./doc.pdf", format: "text", force: true },
      { cwd: dir },
    );
    const result = await service.search(
      {
        action: "search",
        documentId: parsed.documentId,
        phrase: "beta",
        maxResults: 1,
      },
      { cwd: dir },
    );
    expect(result.phrase).toBe("beta");
    expect(result.matches[0]).toHaveProperty("pageNum");
  });
});
