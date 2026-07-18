import { describe, it, expect, beforeEach } from "vite-plus/test";
import { writeFileSync, mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";
import { CONFIG_DIR_NAME } from "@earendil-works/pi-coding-agent";
import { initConfig, loadConfig, resetConfig } from "../src/config";

function tmpDir() {
  const dir = join(tmpdir(), `pi-parseview-test-${randomUUID()}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}

describe("loadConfig", () => {
  beforeEach(() => {
    resetConfig();
  });

  it("returns defaults when initConfig has not been called", () => {
    const cfg = loadConfig();
    expect(cfg.defaultFormat).toBe("browser");
    expect(cfg.fontSize).toBe(16);
    expect(cfg.ocrEnabled).toBe(false);
    expect(cfg.cacheTtl).toBe(300);
    expect(cfg.diagramDefaultFormat).toBe("ascii");
    expect(cfg.puppeteerExecutablePath).toBeUndefined();
  });

  it("ocrEnabled defaults to false", () => {
    const cfg = loadConfig();
    expect(cfg.ocrEnabled).toBe(false);
  });

  it("reads settings from global settings.json", () => {
    const dir = tmpDir();
    const settingsDir = join(dir, "agent");
    mkdirSync(settingsDir, { recursive: true });
    writeFileSync(
      join(settingsDir, "settings.json"),
      JSON.stringify({ "pi-parseview": { fontSize: 20, ocrEnabled: true } }),
    );

    initConfig(dir, settingsDir);
    const cfg = loadConfig();
    expect(cfg.fontSize).toBe(20);
    expect(cfg.ocrEnabled).toBe(true);
    expect(cfg.defaultFormat).toBe("browser");
    rmSync(dir, { recursive: true, force: true });
  });

  it("project settings override global settings", () => {
    const dir = tmpDir();
    const agentDir = join(dir, "agent");
    mkdirSync(agentDir, { recursive: true });
    writeFileSync(
      join(agentDir, "settings.json"),
      JSON.stringify({ "pi-parseview": { fontSize: 20, ocrEnabled: true } }),
    );
    const projDir = join(dir, "project");
    mkdirSync(join(projDir, CONFIG_DIR_NAME), { recursive: true });
    writeFileSync(
      join(projDir, CONFIG_DIR_NAME, "settings.json"),
      JSON.stringify({ "pi-parseview": { fontSize: 14 } }),
    );

    initConfig(projDir, agentDir);
    const cfg = loadConfig();
    expect(cfg.fontSize).toBe(14);
    expect(cfg.ocrEnabled).toBe(true);
    rmSync(dir, { recursive: true, force: true });
  });

  it("missing settings files are silently skipped", () => {
    const dir = tmpDir();
    const agentDir = join(dir, "nonexistent-agent");

    initConfig(dir, agentDir);
    const cfg = loadConfig();
    expect(cfg.fontSize).toBe(16);
    expect(cfg.ocrEnabled).toBe(false);
  });

  it("clamps fontSize outside 10-24 range", () => {
    const dir = tmpDir();
    const agentDir = join(dir, "agent");
    mkdirSync(agentDir, { recursive: true });
    writeFileSync(
      join(agentDir, "settings.json"),
      JSON.stringify({ "pi-parseview": { fontSize: 100 } }),
    );

    initConfig(dir, agentDir);
    const cfg = loadConfig();
    expect(cfg.fontSize).toBe(24);
    rmSync(dir, { recursive: true, force: true });
  });

  it("falls back to default on invalid enum values", () => {
    const dir = tmpDir();
    const agentDir = join(dir, "agent");
    mkdirSync(agentDir, { recursive: true });
    writeFileSync(
      join(agentDir, "settings.json"),
      JSON.stringify({ "pi-parseview": { defaultFormat: "excel", diagramDefaultFormat: "pdf" } }),
    );

    initConfig(dir, agentDir);
    const cfg = loadConfig();
    expect(cfg.defaultFormat).toBe("browser");
    expect(cfg.diagramDefaultFormat).toBe("ascii");
    rmSync(dir, { recursive: true, force: true });
  });
});
