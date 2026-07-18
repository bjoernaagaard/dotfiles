import { mkdtemp, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, it, expect } from "vite-plus/test";
import { DEFAULT_CONFIG, loadResolvedConfig } from "../../src/document/config";

async function tempConfigFile(data: unknown): Promise<string> {
  const dir = await mkdtemp(path.join(os.tmpdir(), "parseview-config-"));
  const configPath = path.join(dir, "parseview.json");
  await writeFile(configPath, JSON.stringify(data), "utf8");
  return configPath;
}

describe("document config", () => {
  it("applies defaults, resolves relative cache paths, and creates a private cache dir", async () => {
    const configPath = await tempConfigFile({ cacheDir: "./cache" });
    const cfg = await loadResolvedConfig("2.6.0", { configPath });
    expect(cfg.cacheDir).toBe(path.join(path.dirname(configPath), "cache"));
    expect(cfg.maxPages).toBe(DEFAULT_CONFIG.maxPages);
    expect(cfg.ocrMode).toBe(DEFAULT_CONFIG.ocrMode);
    expect((await stat(cfg.cacheDir)).mode & 0o777).toBe(0o700);
  });

  it("uses and normalizes legacy config only when the primary file is absent", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "parseview-legacy-config-"));
    const primary = path.join(dir, "parseview.json");
    const legacy = path.join(dir, "liteparse.json");
    await writeFile(
      legacy,
      JSON.stringify({ cacheDir: "./legacy-cache", ocrEnabled: true }),
      "utf8",
    );

    const fromLegacy = await loadResolvedConfig("2.6.0", {
      configPath: primary,
      legacyConfigPath: legacy,
    });
    expect(fromLegacy.cacheDir).toBe(path.join(dir, "legacy-cache"));
    expect(fromLegacy.ocrMode).toBe("auto");

    await writeFile(
      primary,
      JSON.stringify({ cacheDir: "./primary-cache", ocrMode: "off" }),
      "utf8",
    );
    const fromPrimary = await loadResolvedConfig("2.6.0", {
      configPath: primary,
      legacyConfigPath: legacy,
    });
    expect(fromPrimary.cacheDir).toBe(path.join(dir, "primary-cache"));
    expect(fromPrimary.ocrMode).toBe("off");
  });

  it("rejects unknown keys, invalid enums, and invalid limits", async () => {
    await expect(
      loadResolvedConfig("2.6.0", {
        configPath: await tempConfigFile({
          cacheDir: "./cache",
          unexpected: true,
        }),
      }),
    ).rejects.toThrow(/Unknown parseview config key/);

    await expect(
      loadResolvedConfig("2.6.0", {
        configPath: await tempConfigFile({
          cacheDir: "./cache",
          ocrMode: "maybe",
        }),
      }),
    ).rejects.toThrow(/ocrMode/);

    await expect(
      loadResolvedConfig("2.6.0", {
        configPath: await tempConfigFile({
          cacheDir: "./cache",
          maxPages: 0,
        }),
      }),
    ).rejects.toThrow(/maxPages/);

    await expect(
      loadResolvedConfig("2.6.0", {
        configPath: await tempConfigFile({
          cacheDir: "./cache",
          maxDocumentCacheBytes: 2_000,
          maxTotalCacheBytes: 1_000,
        }),
      }),
    ).rejects.toThrow(/maxDocumentCacheBytes/);
  });

  it("validates OCR URLs, environment names, and hedge delays", async () => {
    await expect(
      loadResolvedConfig("2.6.0", {
        configPath: await tempConfigFile({
          cacheDir: "./cache",
          ocrServerUrl: "file:///tmp/ocr",
        }),
      }),
    ).rejects.toThrow(/http or https/);

    await expect(
      loadResolvedConfig("2.6.0", {
        configPath: await tempConfigFile({
          cacheDir: "./cache",
          passwordEnv: "bad-name",
        }),
      }),
    ).rejects.toThrow(/environment variable name/);

    await expect(
      loadResolvedConfig("2.6.0", {
        configPath: await tempConfigFile({
          cacheDir: "./cache",
          ocrHedgeDelaysMs: [0, -1],
        }),
      }),
    ).rejects.toThrow(/ocrHedgeDelaysMs/);
  });

  it("resolves env secrets without serializing them", async () => {
    const env = {
      PARSEVIEW_TEST_PASSWORD: "secret-password",
      PARSEVIEW_TEST_HEADERS: JSON.stringify({
        Authorization: "Bearer abc",
        "X-Trace": "123",
      }),
    };
    const configPath = await tempConfigFile({
      cacheDir: "./cache",
      passwordEnv: "PARSEVIEW_TEST_PASSWORD",
      ocrServerHeadersEnv: "PARSEVIEW_TEST_HEADERS",
    });
    const cfg = await loadResolvedConfig("2.6.0", { configPath, env });
    expect(cfg.secrets.password).toBe("secret-password");
    expect(cfg.secrets.ocrServerHeaders).toMatchObject({
      Authorization: "Bearer abc",
    });
    expect(JSON.stringify(cfg)).not.toContain("secret-password");
    expect(JSON.stringify(cfg)).not.toContain("Bearer abc");
    expect(cfg.secrets.fingerprint).toHaveLength(64);
  });

  it("rejects missing or malformed secret environment values", async () => {
    const missing = await tempConfigFile({
      cacheDir: "./cache",
      passwordEnv: "MISSING_PASSWORD",
    });
    await expect(loadResolvedConfig("2.6.0", { configPath: missing, env: {} })).rejects.toThrow(
      /missing environment variable/,
    );

    const malformed = await tempConfigFile({
      cacheDir: "./cache",
      ocrServerHeadersEnv: "BAD_HEADERS",
    });
    await expect(
      loadResolvedConfig("2.6.0", {
        configPath: malformed,
        env: { BAD_HEADERS: "[]" },
      }),
    ).rejects.toThrow(/JSON object/);
  });
});
