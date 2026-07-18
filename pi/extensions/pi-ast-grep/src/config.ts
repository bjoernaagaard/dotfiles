import { readFile, realpath, stat } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { CONFIG_DIR_NAME, DEFAULT_MAX_BYTES, DEFAULT_MAX_LINES } from "@earendil-works/pi-coding-agent";
import type { Diagnostic } from "./domain.js";
import { isWithin } from "./ast-grep/path.js";

export interface AstGrepLimits {
  readonly timeoutMs: number;
  readonly maxPaths: number;
  readonly maxResults: number;
  readonly maxOutputBytes: number;
  readonly maxOutputLines: number;
  readonly maxProcessOutputBytes: number;
  readonly maxProcessOutputLines: number;
}

export interface AstGrepConfig {
  /** Production always resolves this name through PATH; tests may inject another value. */
  readonly executable: string;
  readonly limits: AstGrepLimits;
  readonly discoverSgConfig: boolean;
  readonly profile: boolean;
  readonly statusStyle: "powerline" | "ascii";
  readonly sgConfigPath?: string;
  readonly globalConfigPath: string;
  readonly globalConfigLoaded: boolean;
  readonly projectConfigPath: string;
  readonly projectConfigLoaded: boolean;
  readonly sgConfigSource?: "global" | "project" | "discovered";
  readonly diagnostics: readonly Diagnostic[];
}

export interface LoadConfigOptions {
  readonly agentDir: string;
  readonly cwd: string;
  readonly configDirName?: string;
}

export const DEFAULT_MAX_PROCESS_OUTPUT_BYTES = 10 * 1024 * 1024;
export const DEFAULT_MAX_PROCESS_OUTPUT_LINES = 100_000;
const HARD_MAX_PROCESS_OUTPUT_BYTES = 32 * 1024 * 1024;
const HARD_MAX_PROCESS_OUTPUT_LINES = 500_000;

export const DEFAULT_LIMITS: AstGrepLimits = Object.freeze({
  timeoutMs: 30_000,
  maxPaths: 64,
  maxResults: 1_000,
  maxOutputBytes: DEFAULT_MAX_BYTES,
  maxOutputLines: DEFAULT_MAX_LINES,
  maxProcessOutputBytes: DEFAULT_MAX_PROCESS_OUTPUT_BYTES,
  maxProcessOutputLines: DEFAULT_MAX_PROCESS_OUTPUT_LINES,
});

const HARD_LIMITS: AstGrepLimits = Object.freeze({
  timeoutMs: 120_000,
  maxPaths: 256,
  maxResults: 10_000,
  maxOutputBytes: DEFAULT_MAX_BYTES,
  maxOutputLines: DEFAULT_MAX_LINES,
  maxProcessOutputBytes: HARD_MAX_PROCESS_OUTPUT_BYTES,
  maxProcessOutputLines: HARD_MAX_PROCESS_OUTPUT_LINES,
});
const CONFIG_MAX_BYTES = 64 * 1024;
const ROOT_KEYS = new Set(["timeoutMs", "limits", "discoverSgConfig", "sgConfig", "profile", "statusStyle"]);
const PROJECT_KEYS = new Set(["timeoutMs", "limits", "discoverSgConfig", "sgConfig", "profile", "statusStyle"]);
const LIMIT_KEYS = new Set([
  "maxPaths", "maxResults", "maxOutputBytes", "maxOutputLines",
  "maxProcessOutputBytes", "maxProcessOutputLines",
]);

interface ParsedConfig {
  timeoutMs?: number;
  limits?: Partial<Omit<AstGrepLimits, "timeoutMs">>;
  discoverSgConfig?: boolean;
  sgConfig?: string;
  profile?: boolean;
  statusStyle?: "powerline" | "ascii";
}

export class ConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ConfigError";
  }
}

export async function loadConfig(options: LoadConfigOptions): Promise<AstGrepConfig> {
  const agentDir = resolve(options.agentDir);
  const cwd = resolve(options.cwd);
  const configDirName = options.configDirName ?? CONFIG_DIR_NAME;
  if (configDirName.length === 0 || configDirName.includes("/") || configDirName.includes("\\")) {
    throw new ConfigError("configDirName must be one path segment");
  }

  const globalConfigPath = join(agentDir, "ast-grep.json");
  const projectConfigPath = join(cwd, configDirName, "ast-grep.json");
  const globalRaw = await readOptionalConfig(globalConfigPath, "global", ROOT_KEYS);
  const projectRaw = await readOptionalConfig(projectConfigPath, "project", PROJECT_KEYS);
  const global = globalRaw ?? {};
  const project = projectRaw ?? {};
  let limits = mergeGlobalLimits(DEFAULT_LIMITS, global, globalConfigPath);
  limits = mergeProjectLimits(limits, project, projectConfigPath);

  let discoverSgConfig = global.discoverSgConfig ?? true;
  if (project.discoverSgConfig === true && !discoverSgConfig) {
    throw new ConfigError(`${projectConfigPath}: project config cannot enable sgconfig discovery disabled globally`);
  }
  if (project.discoverSgConfig === false) discoverSgConfig = false;

  let sgConfigPath: string | undefined;
  let sgConfigSource: AstGrepConfig["sgConfigSource"];
  if (global.sgConfig !== undefined) {
    sgConfigPath = normalizeConfiguredPath(global.sgConfig, agentDir, "global sgConfig");
    sgConfigSource = "global";
  }
  if (project.sgConfig !== undefined) {
    if (sgConfigPath !== undefined) throw new ConfigError(`${projectConfigPath}: project config cannot override global sgConfig`);
    const candidate = normalizeConfiguredPath(project.sgConfig, cwd, "project sgConfig");
    const canonical = await canonicalRegularFile(candidate, "project sgConfig");
    const canonicalCwd = await realpath(cwd);
    if (!isWithin(cwd, candidate) || !isWithin(canonicalCwd, canonical)) {
      throw new ConfigError(`${projectConfigPath}: project sgConfig must stay within cwd (including symlinks)`);
    }
    sgConfigPath = canonical;
    sgConfigSource = "project";
  }
  if (sgConfigPath === undefined && discoverSgConfig) {
    sgConfigPath = await discoverSgConfigUpward(cwd);
    if (sgConfigPath !== undefined) sgConfigSource = "discovered";
  }
  if (sgConfigPath !== undefined) sgConfigPath = await canonicalRegularFile(sgConfigPath, "sgConfig");

  return {
    executable: "ast-grep",
    limits,
    discoverSgConfig,
    profile: project.profile ?? global.profile ?? false,
    statusStyle: project.statusStyle ?? global.statusStyle ?? "powerline",
    ...(sgConfigPath === undefined ? {} : { sgConfigPath }),
    globalConfigPath,
    globalConfigLoaded: globalRaw !== undefined,
    projectConfigPath,
    projectConfigLoaded: projectRaw !== undefined,
    ...(sgConfigSource === undefined ? {} : { sgConfigSource }),
    diagnostics: [],
  };
}

export async function discoverSgConfigUpward(startDirectory: string): Promise<string | undefined> {
  let directory = resolve(startDirectory);
  while (true) {
    for (const name of ["sgconfig.yml", "sgconfig.yaml"] as const) {
      const candidate = join(directory, name);
      if (await isRegularFile(candidate)) return realpath(candidate);
    }
    const parent = dirname(directory);
    if (parent === directory) return undefined;
    directory = parent;
  }
}

function mergeGlobalLimits(base: AstGrepLimits, config: ParsedConfig, source: string): AstGrepLimits {
  return applyLimits(base, requestedLimits(config), HARD_LIMITS, source, "hard");
}

function mergeProjectLimits(base: AstGrepLimits, config: ParsedConfig, source: string): AstGrepLimits {
  return applyLimits(base, requestedLimits(config), base, source, "global");
}

function requestedLimits(config: ParsedConfig): Partial<AstGrepLimits> {
  return { ...(config.timeoutMs === undefined ? {} : { timeoutMs: config.timeoutMs }), ...config.limits };
}

function applyLimits(
  base: AstGrepLimits,
  requested: Partial<AstGrepLimits>,
  ceiling: AstGrepLimits,
  source: string,
  ceilingName: string,
): AstGrepLimits {
  const next = { ...base };
  for (const key of Object.keys(requested) as (keyof AstGrepLimits)[]) {
    const value = requested[key];
    if (value === undefined) continue;
    if (!Number.isInteger(value) || value < 1) throw new ConfigError(`${source}: ${key} must be a positive integer`);
    if (value > ceiling[key]) throw new ConfigError(`${source}: ${key} cannot exceed ${ceilingName} limit ${ceiling[key]}`);
    next[key] = value;
  }
  return next;
}

async function readOptionalConfig(
  path: string,
  scope: "global" | "project",
  allowedKeys: ReadonlySet<string>,
): Promise<ParsedConfig | undefined> {
  let text: string;
  try {
    const info = await stat(path);
    if (!info.isFile()) throw new ConfigError(`${path}: config is not a regular file`);
    if (info.size > CONFIG_MAX_BYTES) throw new ConfigError(`${path}: config exceeds ${CONFIG_MAX_BYTES} bytes`);
    text = await readFile(path, "utf8");
  } catch (error) {
    if (isEnoent(error)) return undefined;
    throw error;
  }

  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch (error) {
    throw new ConfigError(`${path}: invalid JSON: ${error instanceof Error ? error.message : String(error)}`);
  }
  if (!isRecord(value)) throw new ConfigError(`${path}: expected a JSON object`);
  for (const key of Object.keys(value)) {
    if (!allowedKeys.has(key)) throw new ConfigError(`${path}: unknown ${scope} setting ${JSON.stringify(key)}`);
  }

  const parsed: ParsedConfig = {};
  if (value.timeoutMs !== undefined) parsed.timeoutMs = strictNumber(value.timeoutMs, path, "timeoutMs");
  if (value.discoverSgConfig !== undefined) {
    if (typeof value.discoverSgConfig !== "boolean") throw new ConfigError(`${path}: discoverSgConfig must be boolean`);
    parsed.discoverSgConfig = value.discoverSgConfig;
  }
  if (value.profile !== undefined) {
    if (typeof value.profile !== "boolean") throw new ConfigError(`${path}: profile must be boolean`);
    parsed.profile = value.profile;
  }
  if (value.statusStyle !== undefined) {
    if (value.statusStyle !== "powerline" && value.statusStyle !== "ascii") throw new ConfigError(`${path}: statusStyle must be powerline or ascii`);
    parsed.statusStyle = value.statusStyle;
  }
  if (value.sgConfig !== undefined) parsed.sgConfig = strictString(value.sgConfig, path, "sgConfig");
  if (value.limits !== undefined) {
    if (!isRecord(value.limits)) throw new ConfigError(`${path}: limits must be an object`);
    for (const key of Object.keys(value.limits)) {
      if (!LIMIT_KEYS.has(key)) throw new ConfigError(`${path}: unknown limits setting ${JSON.stringify(key)}`);
    }
    const limits: Record<string, number> = {};
    for (const key of LIMIT_KEYS) {
      const candidate = value.limits[key];
      if (candidate !== undefined) limits[key] = strictNumber(candidate, path, `limits.${key}`);
    }
    parsed.limits = limits;
  }
  return parsed;
}

function normalizeConfiguredPath(value: string, base: string, label: string): string {
  if (value.length === 0 || value.includes("\0")) throw new ConfigError(`${label} must be non-empty and contain no NUL bytes`);
  return resolve(base, value.replace(/^@/u, ""));
}

async function canonicalRegularFile(path: string, label: string): Promise<string> {
  try {
    const canonical = await realpath(path);
    if (!(await stat(canonical)).isFile()) throw new ConfigError(`${label} is not a regular file: ${path}`);
    return canonical;
  } catch (error) {
    if (isEnoent(error)) throw new ConfigError(`${label} is not a regular file: ${path}`);
    throw error;
  }
}

async function isRegularFile(path: string): Promise<boolean> {
  try {
    return (await stat(await realpath(path))).isFile();
  } catch (error) {
    if (isEnoent(error)) return false;
    throw error;
  }
}

function strictString(value: unknown, path: string, key: string): string {
  if (typeof value !== "string" || value.length === 0) throw new ConfigError(`${path}: ${key} must be a non-empty string`);
  return value;
}

function strictNumber(value: unknown, path: string, key: string): number {
  if (typeof value !== "number") throw new ConfigError(`${path}: ${key} must be a number`);
  return value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isEnoent(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT";
}
