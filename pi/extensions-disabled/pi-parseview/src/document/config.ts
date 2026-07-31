import { getAgentDir } from "@earendil-works/pi-coding-agent";
import { chmod, mkdir, readFile, realpath, stat } from "node:fs/promises";
import path from "node:path";
import { sha256Hex, stableStringify } from "./utils";
import type { LiteparseFileConfig, ResolvedConfig, ResolvedSecrets } from "./tool-types";

const AGENT_DIR = getAgentDir();
const PRIMARY_CONFIG_FILE_NAME = "parseview.json";
const LEGACY_CONFIG_FILE_NAME = "liteparse.json";

export const CONFIG_PATH = path.join(AGENT_DIR, PRIMARY_CONFIG_FILE_NAME);
export const LEGACY_CONFIG_PATH = path.join(AGENT_DIR, LEGACY_CONFIG_FILE_NAME);
export const SCHEMA_VERSION = 1;

export const DEFAULT_CONFIG: LiteparseFileConfig = {
  cacheDir: path.join(AGENT_DIR, "cache", "parseview", "documents"),
  maxInputBytes: 100 * 1024 * 1024,
  maxPages: 100,
  maxDpi: 300,
  defaultDpi: 150,
  maxScreenshots: 4,
  maxOutputBytes: 20 * 1024,
  maxSearchResults: 20,
  maxDocumentCacheBytes: 500 * 1024 * 1024,
  maxTotalCacheBytes: 5 * 1024 * 1024 * 1024,
  ocrMode: "auto",
  ocrLanguage: "eng",
  ocrFailureFatal: true,
  ocrHedgeDelaysMs: [],
};

const CONFIG_KEYS = new Set<keyof LiteparseFileConfig>([
  "cacheDir",
  "maxInputBytes",
  "maxPages",
  "maxDpi",
  "defaultDpi",
  "maxScreenshots",
  "maxOutputBytes",
  "maxSearchResults",
  "maxDocumentCacheBytes",
  "maxTotalCacheBytes",
  "ocrMode",
  "ocrLanguage",
  "ocrFailureFatal",
  "ocrHedgeDelaysMs",
  "ocrServerUrl",
  "tessdataPath",
  "passwordEnv",
  "ocrServerHeadersEnv",
]);

export interface LoadConfigOptions {
  configPath?: string;
  legacyConfigPath?: string;
  env?: NodeJS.ProcessEnv;
}

export async function loadResolvedConfig(
  packageVersion: string,
  options: LoadConfigOptions = {},
): Promise<ResolvedConfig> {
  const { configPath, usedLegacy } = await resolveConfigPath(
    options.configPath,
    options.legacyConfigPath,
  );
  const fileConfig = await readConfigFile(configPath);
  const mergedConfig = normalizeLegacyConfig(fileConfig, usedLegacy);

  assertKnownKeys(mergedConfig);
  const merged = { ...DEFAULT_CONFIG, ...mergedConfig };
  const configDir = path.dirname(configPath);
  const cacheDir = resolvePath(validateNonEmptyString(merged.cacheDir, "cacheDir"), configDir);
  await ensureCacheDir(cacheDir);

  const maxDpi = validatePositiveInteger(merged.maxDpi, "maxDpi");
  const defaultDpi = validatePositiveInteger(merged.defaultDpi, "defaultDpi");
  if (defaultDpi > maxDpi) throw new Error("defaultDpi must be <= maxDpi");

  const maxDocumentCacheBytes = validatePositiveInteger(
    merged.maxDocumentCacheBytes,
    "maxDocumentCacheBytes",
  );
  const maxTotalCacheBytes = validatePositiveInteger(
    merged.maxTotalCacheBytes,
    "maxTotalCacheBytes",
  );
  if (maxDocumentCacheBytes > maxTotalCacheBytes) {
    throw new Error("maxDocumentCacheBytes must be <= maxTotalCacheBytes");
  }

  const passwordEnv = validateOptionalEnvName(merged.passwordEnv, "passwordEnv");
  const ocrServerHeadersEnv = validateOptionalEnvName(
    merged.ocrServerHeadersEnv,
    "ocrServerHeadersEnv",
  );
  const env = options.env ?? process.env;
  const secrets = resolveSecrets({ passwordEnv, ocrServerHeadersEnv }, env);

  const ocrServerUrl = validateOptionalString(merged.ocrServerUrl, "ocrServerUrl");
  if (ocrServerUrl) {
    const url = new URL(ocrServerUrl);
    if (url.protocol !== "http:" && url.protocol !== "https:") {
      throw new Error("ocrServerUrl must use http or https");
    }
  }

  const tessdataRaw = validateOptionalString(merged.tessdataPath, "tessdataPath");
  const tessdataPath = tessdataRaw ? resolvePath(tessdataRaw, configDir) : undefined;
  if (tessdataPath) {
    const tessdataStat = await stat(tessdataPath).catch((error: NodeJS.ErrnoException) => {
      if (error.code === "ENOENT") return undefined;
      throw error;
    });
    if (tessdataStat && !tessdataStat.isDirectory()) {
      throw new Error("tessdataPath must resolve to a directory");
    }
  }

  const resolved: ResolvedConfig = {
    cacheDir,
    cacheDirRealPath: await realpath(cacheDir),
    packageVersion,
    maxInputBytes: validatePositiveInteger(merged.maxInputBytes, "maxInputBytes"),
    maxPages: validatePositiveInteger(merged.maxPages, "maxPages"),
    maxDpi,
    defaultDpi,
    maxScreenshots: validatePositiveInteger(merged.maxScreenshots, "maxScreenshots"),
    maxOutputBytes: validatePositiveInteger(merged.maxOutputBytes, "maxOutputBytes"),
    maxSearchResults: validatePositiveInteger(merged.maxSearchResults, "maxSearchResults"),
    maxDocumentCacheBytes,
    maxTotalCacheBytes,
    ocrMode: validateEnum(merged.ocrMode, ["auto", "on", "off"] as const, "ocrMode"),
    ocrLanguage: validateNonEmptyString(merged.ocrLanguage, "ocrLanguage"),
    ocrFailureFatal: validateBoolean(merged.ocrFailureFatal, "ocrFailureFatal"),
    ocrHedgeDelaysMs: validateDelayArray(merged.ocrHedgeDelaysMs),
    ocrServerUrl,
    tessdataPath,
    passwordEnv,
    ocrServerHeadersEnv,
    secrets,
  };
  Object.defineProperty(secrets, "toJSON", {
    value: () => ({ fingerprint: secrets.fingerprint }),
    enumerable: false,
  });
  Object.defineProperty(resolved, "toJSON", {
    value: () => ({
      ...resolved,
      secrets: { fingerprint: secrets.fingerprint },
    }),
    enumerable: false,
  });
  return resolved;
}

async function resolveConfigPath(
  explicitPrimary: string | undefined,
  explicitLegacy: string | undefined,
): Promise<{ configPath: string; usedLegacy: boolean }> {
  const primary = explicitPrimary ?? CONFIG_PATH;
  const legacy = explicitLegacy ?? LEGACY_CONFIG_PATH;

  if (await pathExists(primary)) {
    return { configPath: primary, usedLegacy: false };
  }
  if (await pathExists(legacy)) {
    return { configPath: legacy, usedLegacy: true };
  }
  return { configPath: primary, usedLegacy: false };
}

async function pathExists(targetPath: string): Promise<boolean> {
  return stat(targetPath)
    .then(() => true)
    .catch((error: NodeJS.ErrnoException) => {
      if (error.code === "ENOENT") return false;
      throw error;
    });
}

function normalizeLegacyConfig(
  fileConfig: Record<string, unknown>,
  usedLegacy: boolean,
): Record<string, unknown> {
  if (!usedLegacy) return fileConfig;

  const migrated = { ...fileConfig };
  if (migrated.ocrMode === undefined && typeof migrated.ocrEnabled === "boolean") {
    // Legacy fallback: old boolean mode defaults to ocrMode auto/off.
    migrated.ocrMode = migrated.ocrEnabled ? "auto" : "off";
    delete migrated.ocrEnabled;
  }
  return migrated;
}

async function readConfigFile(configPath: string): Promise<Record<string, unknown>> {
  try {
    const parsed: unknown = JSON.parse(await readFile(configPath, "utf8"));
    if (!isPlainObject(parsed)) throw new Error("Document parser config must be a JSON object");
    return parsed;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return {};
    throw error;
  }
}

function assertKnownKeys(config: Record<string, unknown>): void {
  for (const key of Object.keys(config)) {
    if (!CONFIG_KEYS.has(key as keyof LiteparseFileConfig)) {
      throw new Error(`Unknown parseview config key: ${key}`);
    }
  }
}

function resolveSecrets(
  refs: { passwordEnv?: string; ocrServerHeadersEnv?: string },
  env: NodeJS.ProcessEnv,
): ResolvedSecrets {
  const password = refs.passwordEnv ? env[refs.passwordEnv] : undefined;
  if (refs.passwordEnv && !password) {
    throw new Error(`passwordEnv references missing environment variable: ${refs.passwordEnv}`);
  }

  let ocrServerHeaders: Record<string, string> | undefined;
  if (refs.ocrServerHeadersEnv) {
    const raw = env[refs.ocrServerHeadersEnv];
    if (!raw) {
      throw new Error(
        `ocrServerHeadersEnv references missing environment variable: ${refs.ocrServerHeadersEnv}`,
      );
    }
    const parsed: unknown = JSON.parse(raw);
    if (!isPlainObject(parsed)) throw new Error("ocrServerHeadersEnv must contain a JSON object");
    ocrServerHeaders = {};
    for (const [key, value] of Object.entries(parsed)) {
      if (!key.trim() || typeof value !== "string") {
        throw new Error(
          "ocrServerHeadersEnv must contain non-empty string header names and values",
        );
      }
      ocrServerHeaders[key] = value;
    }
  }

  const fingerprint = sha256Hex(
    stableStringify({
      password: password ?? null,
      headers: ocrServerHeaders ?? null,
    }),
  );
  return { password, ocrServerHeaders, fingerprint };
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function resolvePath(value: string, baseDir: string): string {
  return path.isAbsolute(value) ? path.normalize(value) : path.resolve(baseDir, value);
}

async function ensureCacheDir(dir: string): Promise<void> {
  const existing = await stat(dir).catch((error: NodeJS.ErrnoException) => {
    if (error.code === "ENOENT") return undefined;
    throw error;
  });
  if (existing && !existing.isDirectory()) throw new Error(`cacheDir resolves to a file: ${dir}`);
  await mkdir(dir, { recursive: true, mode: 0o700 });
  await chmod(dir, 0o700);
}

function validatePositiveInteger(value: unknown, name: string): number {
  if (
    typeof value !== "number" ||
    !Number.isFinite(value) ||
    !Number.isInteger(value) ||
    value <= 0
  ) {
    throw new Error(`${name} must be a positive integer`);
  }
  return value;
}

function validateBoolean(value: unknown, name: string): boolean {
  if (typeof value !== "boolean") throw new Error(`${name} must be boolean`);
  return value;
}

function validateEnum<const T extends readonly string[]>(
  value: unknown,
  allowed: T,
  name: string,
): T[number] {
  if (typeof value !== "string" || !allowed.includes(value)) {
    throw new Error(`${name} must be one of: ${allowed.join(", ")}`);
  }
  return value as T[number];
}

function validateNonEmptyString(value: unknown, name: string): string {
  if (typeof value !== "string" || !value.trim())
    throw new Error(`${name} must be a non-empty string`);
  return value.trim();
}

function validateOptionalString(value: unknown, name: string): string | undefined {
  if (value === undefined || value === null) return undefined;
  return validateNonEmptyString(value, name);
}

function validateOptionalEnvName(value: unknown, name: string): string | undefined {
  const result = validateOptionalString(value, name);
  if (result && !/^[A-Za-z_][A-Za-z0-9_]*$/.test(result)) {
    throw new Error(`${name} must be a valid environment variable name`);
  }
  return result;
}

function validateDelayArray(value: unknown): number[] {
  if (!Array.isArray(value)) throw new Error("ocrHedgeDelaysMs must be an array");
  return value.map((item, index) => {
    if (typeof item !== "number" || !Number.isFinite(item) || !Number.isInteger(item) || item < 0) {
      throw new Error(`ocrHedgeDelaysMs[${index}] must be a non-negative integer`);
    }
    return item;
  });
}

export async function ensureDirectoryMode700(dir: string): Promise<void> {
  await mkdir(dir, { recursive: true, mode: 0o700 });
  await chmod(dir, 0o700);
}

export async function pathLooksLikeFile(pathname: string): Promise<boolean> {
  try {
    return (await stat(pathname)).isFile();
  } catch {
    return false;
  }
}
