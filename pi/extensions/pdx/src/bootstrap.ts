import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { commandDetails, formatCommandResult, lastLine } from "./output.js";
import { parseJsonOutput, runCommand } from "./runner.js";
import type { PermissionMode, PdxConfig, PdxToolDetails } from "./types.js";

export const BOOTSTRAP_PARTS = [
  "packages",
  "repos",
  "dotfiles",
  "mise-shell-activate",
  "macos-defaults",
  "macos-launchd-agents",
  "linux-systemd-units",
  "user",
  "tools",
  "task",
  "final-hook",
] as const;

export type BootstrapPart = typeof BOOTSTRAP_PARTS[number];
export type MiseBootstrapAction = "status" | "plan" | "apply";

export interface MiseBootstrapParams {
  readonly action: MiseBootstrapAction;
  readonly only?: readonly string[];
  readonly skip?: readonly string[];
  readonly update?: boolean;
  readonly forceDotfiles?: boolean;
  readonly timeoutMs?: number;
}

type Confirm = (title: string, body: string) => Promise<void>;

function isBootstrapPart(value: string): value is BootstrapPart {
  return (BOOTSTRAP_PARTS as readonly string[]).includes(value);
}

function validate(params: MiseBootstrapParams): void {
  if (params.action === "status" && (params.only?.length || params.skip?.length || params.update || params.forceDotfiles)) {
    throw new Error("pdx_mise_bootstrap: status does not accept execution options");
  }
  if (params.only?.length && params.skip?.length) {
    throw new Error("pdx_mise_bootstrap: only and skip cannot be used together");
  }
  for (const part of [...(params.only ?? []), ...(params.skip ?? [])]) {
    if (!isBootstrapPart(part)) {
      throw new Error(`pdx_mise_bootstrap: unsupported part '${part}'`);
    }
  }
  if (params.timeoutMs !== undefined && (!Number.isInteger(params.timeoutMs) || params.timeoutMs <= 0)) {
    throw new Error("pdx_mise_bootstrap: timeoutMs must be a positive integer");
  }
}

function executionArgs(params: MiseBootstrapParams, mode: "preview" | "apply"): string[] {
  const args = ["bootstrap"];
  if (mode === "preview") args.push("--dry-run");
  if (mode === "apply") args.push("--yes");
  if (params.only?.length) args.push("--only", params.only.join(","));
  if (params.skip?.length) args.push("--skip", params.skip.join(","));
  if (params.update) args.push("--update");
  if (params.forceDotfiles) args.push("--force-dotfiles");
  return args;
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

function asArray(value: unknown): readonly unknown[] {
  return Array.isArray(value) ? value : [];
}

function stateOf(value: unknown): string | undefined {
  return typeof asRecord(value)?.state === "string" ? asRecord(value)?.state as string : undefined;
}

function labelOf(value: unknown, fallback: string): string {
  const record = asRecord(value);
  for (const key of ["path_raw", "path", "target", "package", "tool", "name", "label"]) {
    if (typeof record?.[key] === "string") return record[key] as string;
  }
  return fallback;
}

function summarizeCollection(label: string, values: readonly unknown[], healthy: readonly string[]): string {
  if (values.length === 0) return `${label}: none`;
  const counts = new Map<string, number>();
  for (const value of values) {
    const state = stateOf(value) ?? "unknown";
    counts.set(state, (counts.get(state) ?? 0) + 1);
  }
  const summary = [...counts.entries()].map(([state, count]) => `${count} ${state}`).join(", ");
  const issues = values
    .filter((value) => !healthy.includes(stateOf(value) ?? "unknown"))
    .slice(0, 4)
    .map((value) => `${labelOf(value, "item")} (${stateOf(value) ?? "unknown"})`);
  return `${label}: ${summary}${issues.length ? `; attention: ${issues.join(", ")}` : ""}`;
}

export function summarizeBootstrapStatus(data: unknown): string {
  const root = asRecord(data);
  if (!root) return "mise bootstrap status: no JSON status was returned";

  const packages = Object.values(asRecord(root.packages) ?? {}).flatMap((manager) => asArray(asRecord(manager)?.packages));
  const repos = asArray(root.repos);
  const dotfiles = [
    ...asArray(asRecord(root.dotfiles)?.files),
    ...asArray(asRecord(root.dotfiles)?.edits),
  ];
  const defaults = asArray(asRecord(root.macos_defaults)?.entries);
  const launchd = asArray(asRecord(root.launchd)?.agents);
  const systemd = asArray(asRecord(root.systemd)?.units);
  const tools = asArray(root.tools);
  const pluginDeps = asArray(root.plugin_deps);
  const shell = asRecord(root.login_shell);
  const shellLine = shell
    ? `login shell: ${stateOf(shell) ?? "unknown"}${typeof shell.current === "string" ? ` (${shell.current})` : ""}`
    : "login shell: unavailable";

  return [
    "mise bootstrap status",
    summarizeCollection("packages", packages, ["installed"]),
    summarizeCollection("repos", repos, ["current"]),
    summarizeCollection("dotfiles", dotfiles, ["applied"]),
    summarizeCollection("macOS defaults", defaults, ["set"]),
    summarizeCollection("LaunchAgents", launchd, ["loaded"]),
    summarizeCollection("systemd units", systemd, ["active", "loaded", "set"]),
    shellLine,
    summarizeCollection("tools", tools, ["installed"]),
    summarizeCollection("plugin dependencies", pluginDeps, ["installed", "current"]),
  ].join("\n");
}

function previewText(text: string): string {
  const limit = 6000;
  if (text.length <= limit) return text.trimEnd() || "(mise returned no preview output)";
  return `${text.slice(0, limit).trimEnd()}\n[… preview truncated by pdx …]`;
}

function commandOutput(stdout: string, stderr: string): string {
  return [stdout.trimEnd(), stderr.trimEnd() ? `stderr:\n${stderr.trimEnd()}` : ""]
    .filter(Boolean)
    .join("\n");
}

function permissionText(permission: PermissionMode): string {
  return permission === "yolo" ? "yolo (no confirmation)" : "ask (one confirmation)";
}

export async function executeMiseBootstrap(
  ctx: ExtensionContext,
  params: MiseBootstrapParams,
  config: PdxConfig,
  progress: (text: string) => void,
  confirm: Confirm,
): Promise<{ content: [{ type: "text"; text: string }]; details: PdxToolDetails }> {
  validate(params);
  const timeoutMs = Math.min(params.timeoutMs ?? 10 * 60_000, 10 * 60_000);

  if (params.action === "status") {
    const args = ["bootstrap", "status", "--json"];
    progress("mise bootstrap: reading status");
    const result = await runCommand({
      command: "mise",
      args,
      cwd: ctx.cwd,
      signal: ctx.signal,
      timeoutMs,
      maxOutputBytes: config.maxOutputBytes,
      onOutput: (_stream, chunk) => progress(`mise bootstrap: ${lastLine(chunk)}`),
    });
    const data = parseJsonOutput(result.stdout);
    const details = commandDetails("mise", "bootstrap_status", ["mise", ...args], result);
    return {
      content: [{ type: "text", text: result.code === 0 && data !== undefined ? summarizeBootstrapStatus(data) : formatCommandResult(details) }],
      details,
    };
  }

  const previewArgs = executionArgs(params, "preview");
  progress(`mise bootstrap: ${params.action === "plan" ? "planning" : "previewing"}`);
  const preview = await runCommand({
    command: "mise",
    args: previewArgs,
    cwd: ctx.cwd,
    signal: ctx.signal,
    timeoutMs,
    maxOutputBytes: config.maxOutputBytes,
    onOutput: (_stream, chunk) => progress(`mise bootstrap: ${lastLine(chunk)}`),
  });
  const previewDetails = commandDetails("mise", "bootstrap_plan", ["mise", ...previewArgs], preview);

  if (params.action === "plan") {
    return {
      content: [{ type: "text", text: formatCommandResult(previewDetails) }],
      details: previewDetails,
    };
  }

  if (preview.code !== 0 || preview.timedOut || preview.killed) {
    return {
      content: [{ type: "text", text: `Bootstrap preview failed; no changes were applied.\n${formatCommandResult(previewDetails)}` }],
      details: previewDetails,
    };
  }

  const permission = config.permissionMode;
  if (permission === "ask") {
    await confirm(
      "Allow targeted mise bootstrap?",
      [
        "This may install packages, change dotfiles, modify OS preferences, and start user services.",
        `Permission: ${permissionText(permission)}`,
        `Working directory: ${ctx.cwd}`,
        `Command: mise ${executionArgs(params, "apply").slice(1).join(" ")}`,
        "",
        previewText(commandOutput(preview.stdout, preview.stderr)),
      ].join("\n"),
    );
  }

  const applyArgs = executionArgs(params, "apply");
  progress("mise bootstrap: applying");
  const result = await runCommand({
    command: "mise",
    args: applyArgs,
    cwd: ctx.cwd,
    signal: ctx.signal,
    timeoutMs,
    maxOutputBytes: config.maxOutputBytes,
    onOutput: (_stream, chunk) => progress(`mise bootstrap: ${lastLine(chunk)}`),
  });
  const details = commandDetails("mise", "bootstrap_apply", ["mise", ...applyArgs], result);
  return {
    content: [{
      type: "text",
      text: [
        `permission: ${permissionText(permission)}`,
        "preview:",
        previewText(commandOutput(preview.stdout, preview.stderr)),
        "",
        formatCommandResult(details),
      ].join("\n"),
    }],
    details,
  };
}
