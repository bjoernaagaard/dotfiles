import os from "node:os";
import path from "node:path";
import { describe, it, expect } from "vite-plus/test";
import { gatherDoctorReport, formatDoctorReport } from "../../src/document/doctor";
import { createFakeNativeLoader, createMemoryCacheStore, makeTempDir } from "./test-helpers";
import type { ResolvedConfig } from "../../src/document/tool-types";

function baseConfig(cacheDir: string): ResolvedConfig {
  return {
    cacheDir,
    cacheDirRealPath: cacheDir,
    packageVersion: "2.6.0",
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
    ocrServerHeadersEnv: "PARSEVIEW_HEADERS",
    tessdataPath: path.join(os.tmpdir(), "missing-tessdata"),
    secrets: { fingerprint: "f".repeat(64) },
  } as ResolvedConfig;
}

describe("doctor", () => {
  it("reports native-load failures and cache/ocr diagnostics without exposing secrets", async () => {
    const cacheDir = await makeTempDir();
    const cache = createMemoryCacheStore();
    const report = await gatherDoctorReport({
      config: baseConfig(cacheDir),
      cache,
      nativeLoader: createFakeNativeLoader(new Error("native missing")),
    });
    const text = formatDoctorReport(report);

    expect(text).toContain("parseview document system doctor");
    expect(text).toContain("nativeLoad: failed");
    expect(text).toContain("cacheUsage: 0 entries");
    expect(text).toContain("ocrHeaders: configured via env");
    expect(text).toContain("soffice:");
    expect(text).toContain("libreoffice:");
    expect(text).toContain("ImageMagick convert:");
    expect(text).toContain("gs:");
  });
});
