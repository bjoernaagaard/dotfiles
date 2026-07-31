import { createRequire } from "node:module";
import { readFile } from "node:fs/promises";
import type { NativeAdapter, NativeInstance } from "./tool-types";

let cachedLoader: Promise<NativeAdapter> | undefined;
let lastError: Error | undefined;
let lastVersion: string | undefined;

export function createNativeLoader(): {
  load: () => Promise<NativeAdapter>;
  getLastError: () => Error | undefined;
  getLastVersion: () => string | undefined;
} {
  return {
    load: loadNativeAdapter,
    getLastError: () => lastError,
    getLastVersion: () => lastVersion,
  };
}

export async function probeLiteparsePackageVersion(): Promise<string> {
  try {
    const require = createRequire(import.meta.url);
    const pkgPath = require.resolve("@llamaindex/liteparse/package.json");
    const pkg = JSON.parse(await readFile(pkgPath, "utf8")) as {
      version?: string;
    };
    return pkg.version ?? "unknown";
  } catch {
    return "unknown";
  }
}

export async function loadNativeAdapter(): Promise<NativeAdapter> {
  if (!cachedLoader) cachedLoader = loadAdapter();
  const pending = cachedLoader;
  try {
    const adapter = await pending;
    lastError = undefined;
    return adapter;
  } catch (error) {
    if (cachedLoader === pending) cachedLoader = undefined;
    throw error;
  }
}

async function loadAdapter(): Promise<NativeAdapter> {
  try {
    const version = await probeLiteparsePackageVersion();
    lastVersion = version;
    const mod = (await import("@llamaindex/liteparse")) as unknown as {
      LiteParse: new (config?: Record<string, unknown>) => NativeInstance;
      searchItems?: NativeAdapter["searchItems"];
    };
    return {
      version,
      create(config: Record<string, unknown>): NativeInstance {
        return new mod.LiteParse(config) as unknown as NativeInstance;
      },
      searchItems: mod.searchItems,
    };
  } catch (error) {
    lastError = error instanceof Error ? error : new Error(String(error));
    throw lastError;
  }
}
