import { homedir } from "node:os";
import { readFile, realpath } from "node:fs/promises";
import { isAbsolute, resolve } from "node:path";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { summarizeBootstrapStatus } from "./bootstrap.js";
import { lastLine } from "./output.js";
import { parseJsonOutput, runCommand } from "./runner.js";
import type { PdxConfig } from "./types.js";

export interface MiseBootstrapDiscovery {
  readonly available: boolean;
  readonly configured: boolean;
  readonly configPaths: readonly string[];
  readonly bootstrapConfigPaths: readonly string[];
  readonly statusText?: string;
  readonly error?: string;
}

interface ConfigEntry {
  readonly path?: unknown;
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

function configPaths(value: unknown, cwd: string): string[] {
  if (!Array.isArray(value)) return [];
  return [...new Set(value
    .map((entry) => asRecord(entry) as ConfigEntry | undefined)
    .map((entry) => entry?.path)
    .filter((path): path is string => typeof path === "string" && path.length > 0)
    .map((path) => {
      const expanded = path === "~"
        ? homedir()
        : path.startsWith("~/")
          ? resolve(homedir(), path.slice(2))
          : path;
      return isAbsolute(expanded) ? expanded : resolve(cwd, expanded);
    }))];
}

/** Detect the Bootstrap table families without attempting to parse arbitrary TOML. */
export function isMiseBootstrapConfig(text: string): boolean {
  return /^\s*\[\[?bootstrap(?:[.\]]|\s)/m.test(text)
    || /^\s*bootstrap\.[A-Za-z0-9_-]+\s*=/m.test(text);
}

function commandFailure(result: { readonly code: number | null; readonly stderr: string }): string {
  const detail = lastLine(result.stderr);
  return detail === "working" ? `exit ${result.code ?? "unknown"}` : detail;
}

async function canonicalPath(path: string): Promise<string> {
  try {
    return await realpath(path);
  } catch {
    return path;
  }
}

export async function discoverMiseBootstrap(
  ctx: ExtensionContext,
  config: PdxConfig,
): Promise<MiseBootstrapDiscovery> {
  const timeoutMs = Math.min(config.defaultTimeoutMs, 10_000);
  let configResult;
  try {
    configResult = await runCommand({
      command: "mise",
      args: ["config", "ls", "--json"],
      cwd: ctx.cwd,
      signal: ctx.signal,
      timeoutMs,
      maxOutputBytes: config.maxOutputBytes,
    });
  } catch (error) {
    return {
      available: false,
      configured: false,
      configPaths: [],
      bootstrapConfigPaths: [],
      error: error instanceof Error ? error.message : String(error),
    };
  }

  if (configResult.code !== 0) {
    return {
      available: true,
      configured: false,
      configPaths: [],
      bootstrapConfigPaths: [],
      error: `mise config discovery failed: ${commandFailure(configResult)}`,
    };
  }

  const paths = configPaths(parseJsonOutput(configResult.stdout), ctx.cwd);
  const configFiles = await Promise.all(paths.map(async (path) => {
    try {
      return {
        path: await canonicalPath(path),
        text: await readFile(path, "utf8"),
      };
    } catch {
      return undefined;
    }
  }));
  const bootstrapConfigPaths = configFiles
    .filter((entry): entry is { path: string; text: string } => Boolean(entry && isMiseBootstrapConfig(entry.text)))
    .map((entry) => entry.path);

  if (bootstrapConfigPaths.length === 0) {
    return {
      available: true,
      configured: false,
      configPaths: paths,
      bootstrapConfigPaths: [],
    };
  }

  let statusText: string | undefined;
  let error: string | undefined;
  try {
    const statusResult = await runCommand({
      command: "mise",
      args: ["bootstrap", "status", "--json"],
      cwd: ctx.cwd,
      signal: ctx.signal,
      timeoutMs,
      maxOutputBytes: config.maxOutputBytes,
    });
    const data = parseJsonOutput(statusResult.stdout);
    if (statusResult.code === 0 && data !== undefined) {
      statusText = summarizeBootstrapStatus(data);
    } else {
      error = `mise bootstrap status failed: ${commandFailure(statusResult)}`;
    }
  } catch (caught) {
    error = caught instanceof Error ? caught.message : String(caught);
  }

  return {
    available: true,
    configured: true,
    configPaths: paths,
    bootstrapConfigPaths,
    ...(statusText ? { statusText } : {}),
    ...(error ? { error } : {}),
  };
}

export function formatMiseBootstrapStatus(discovery: MiseBootstrapDiscovery): string {
  if (!discovery.available) return `mise Bootstrap: unavailable${discovery.error ? ` (${discovery.error})` : ""}`;
  if (!discovery.configured) return `mise Bootstrap: not detected${discovery.error ? ` (${discovery.error})` : ""}`;

  const lines = [
    "mise Bootstrap: detected",
    `config: ${discovery.bootstrapConfigPaths.join(", ")}`,
  ];
  if (discovery.statusText) lines.push(discovery.statusText);
  if (discovery.error) lines.push(`status warning: ${discovery.error}`);
  return lines.join("\n");
}

export function formatMiseBootstrapPrompt(discovery: MiseBootstrapDiscovery): string {
  return [
    "<pdx-environment>",
    "The current environment has an effective mise Bootstrap configuration.",
    `Bootstrap config: ${discovery.bootstrapConfigPaths.join(", ")}`,
    discovery.statusText ? `Current Bootstrap status:\n${discovery.statusText}` : "Bootstrap status is currently unavailable; use pdx_mise_bootstrap with action=status before making assumptions.",
    "For machine setup, dotfiles, packages, managed repositories, OS preferences, shell activation, or mise-managed tools, use pdx_mise_bootstrap rather than a generic shell command.",
    "Use action=status for inspection, action=plan before changes, and action=apply only when the user has requested the change.",
    "</pdx-environment>",
  ].join("\n");
}
