import { access, readFile } from "node:fs/promises";
import { constants } from "node:fs";
import { join } from "node:path";
import {
  CONFIG_DIR_NAME,
  getAgentDir,
  type ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import type { PermissionMode, PdxConfig, PdxRawConfig } from "./types.js";

const CONFIG_NAME = "pdx.json";
const DEFAULT_MAX_OUTPUT_BYTES = 50 * 1024;
const DEFAULT_TIMEOUT_MS = 30_000;
const DEFAULT_MAX_LOG_LINES = 200;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function positiveNumber(value: unknown, field: string): number | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    throw new Error(`pdx config: ${field} must be a positive number`);
  }
  return Math.floor(value);
}

function boolean(value: unknown, field: string): boolean | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "boolean") throw new Error(`pdx config: ${field} must be a boolean`);
  return value;
}

function permissionMode(value: unknown, field: string): PermissionMode | undefined {
  if (value === undefined) return undefined;
  if (value !== "ask" && value !== "yolo") {
    throw new Error(`pdx config: ${field} must be "ask" or "yolo"`);
  }
  return value;
}

function parseRaw(value: unknown, source: string): PdxRawConfig {
  if (!isRecord(value)) throw new Error(`pdx config ${source} must contain a JSON object`);

  return {
    enabled: boolean(value.enabled, `${source}.enabled`),
    permissionMode: permissionMode(value.permissionMode, `${source}.permissionMode`),
    maxOutputBytes: positiveNumber(value.maxOutputBytes, `${source}.maxOutputBytes`),
    defaultTimeoutMs: positiveNumber(value.defaultTimeoutMs, `${source}.defaultTimeoutMs`),
    maxLogLines: positiveNumber(value.maxLogLines, `${source}.maxLogLines`),
  };
}

async function readRaw(path: string): Promise<PdxRawConfig | undefined> {
  try {
    await access(path, constants.R_OK);
  } catch {
    return undefined;
  }
  const text = await readFile(path, "utf8");
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch (error) {
    throw new Error(`pdx config ${path} is not valid JSON: ${error instanceof Error ? error.message : String(error)}`);
  }
  return parseRaw(value, path);
}

function mergeRaw(global: PdxRawConfig | undefined, project: PdxRawConfig | undefined): PdxRawConfig {
  const g = global ?? {};
  const p = project ?? {};

  return {
    // A project can disable an extension, but cannot re-enable one disabled globally.
    enabled: (g.enabled ?? true) && (p.enabled ?? true),
    // A project can narrow a global YOLO mode, but cannot elevate ASK.
    permissionMode: g.permissionMode === "yolo" && p.permissionMode !== "ask" ? "yolo" : "ask",
    maxOutputBytes: Math.min(g.maxOutputBytes ?? DEFAULT_MAX_OUTPUT_BYTES, p.maxOutputBytes ?? Number.MAX_SAFE_INTEGER),
    defaultTimeoutMs: Math.min(g.defaultTimeoutMs ?? DEFAULT_TIMEOUT_MS, p.defaultTimeoutMs ?? Number.MAX_SAFE_INTEGER),
    maxLogLines: Math.min(g.maxLogLines ?? DEFAULT_MAX_LOG_LINES, p.maxLogLines ?? Number.MAX_SAFE_INTEGER),
  };
}

function resolved(raw: PdxRawConfig, sources: readonly string[]): PdxConfig {
  return {
    enabled: raw.enabled ?? true,
    permissionMode: raw.permissionMode ?? "ask",
    maxOutputBytes: Math.max(1024, Math.min(raw.maxOutputBytes ?? DEFAULT_MAX_OUTPUT_BYTES, DEFAULT_MAX_OUTPUT_BYTES)),
    defaultTimeoutMs: Math.max(1000, Math.min(raw.defaultTimeoutMs ?? DEFAULT_TIMEOUT_MS, 10 * 60_000)),
    maxLogLines: Math.max(1, Math.min(raw.maxLogLines ?? DEFAULT_MAX_LOG_LINES, 2000)),
    sources,
  };
}

export async function loadConfig(ctx: ExtensionContext): Promise<PdxConfig> {
  const globalPath = join(getAgentDir(), CONFIG_NAME);
  const projectPath = join(ctx.cwd, CONFIG_DIR_NAME, CONFIG_NAME);
  const global = await readRaw(globalPath);
  const project = ctx.isProjectTrusted() ? await readRaw(projectPath) : undefined;
  const sources = [
    ...(global ? [globalPath] : []),
    ...(project ? [projectPath] : []),
  ];
  return resolved(mergeRaw(global, project), sources);
}
