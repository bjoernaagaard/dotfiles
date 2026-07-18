import { lastLine, commandDetails, formatCommandResult } from "./output.js";
import { parseJsonOutput, runCommand } from "./runner.js";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { PdxConfig, PdxToolDetails } from "./types.js";

export type MiseAction = "tools" | "tasks" | "env" | "config" | "run" | "install";

export interface MiseParams {
  readonly action: MiseAction;
  readonly task?: string;
  readonly args?: readonly string[];
  readonly tool?: string;
  readonly version?: string;
  readonly includeValues?: boolean;
  readonly timeoutMs?: number;
}

function validate(params: MiseParams): void {
  if (params.action === "run") {
    if (!params.task) throw new Error("pdx_mise: run requires task");
  }
  if (params.action === "install") {
    if (!params.tool) throw new Error("pdx_mise: install requires tool");
    if (params.args?.length) throw new Error("pdx_mise: args are only valid for run");
  }
  if (params.action !== "run" && params.args?.length) {
    throw new Error("pdx_mise: args are only valid for run");
  }
  if (params.action !== "install" && params.version) {
    throw new Error("pdx_mise: version is only valid for install");
  }
  if (params.includeValues && params.action !== "env") {
    throw new Error("pdx_mise: includeValues is only valid for env");
  }
  if (params.timeoutMs !== undefined && (!Number.isInteger(params.timeoutMs) || params.timeoutMs <= 0)) {
    throw new Error("pdx_mise: timeoutMs must be a positive integer");
  }
}

export function miseNeedsConfirmation(params: MiseParams): boolean {
  return params.action === "install"
    || params.action === "run"
    || (params.action === "env" && params.includeValues === true);
}

export async function executeMise(
  ctx: ExtensionContext,
  params: MiseParams,
  config: PdxConfig,
  progress: (text: string) => void,
): Promise<{ content: [{ type: "text"; text: string }]; details: PdxToolDetails }> {
  validate(params);
  const args: string[] = [];
  switch (params.action) {
    case "tools":
      args.push("ls", "--json");
      break;
    case "tasks":
      args.push("tasks", "ls", "--json");
      break;
    case "env":
      args.push("env", "--json", ...(params.includeValues ? [] : ["--redacted"]));
      break;
    case "config":
      args.push("config", "ls", "--json");
      break;
    case "run":
      args.push("run", params.task!, ...(params.args ?? []));
      break;
    case "install":
      args.push("install", `${params.tool}${params.version ? `@${params.version}` : ""}`);
      break;
  }

  const timeoutMs = Math.min(params.timeoutMs ?? config.defaultTimeoutMs, 10 * 60_000);
  progress(`mise ${params.action}: running`);
  const result = await runCommand({
    command: "mise",
    args,
    cwd: ctx.cwd,
    signal: ctx.signal,
    timeoutMs,
    maxOutputBytes: config.maxOutputBytes,
    onOutput: (_stream, chunk) => progress(`mise ${params.action}: ${lastLine(chunk)}`),
  });
  const data = ["tools", "tasks", "env", "config"].includes(params.action)
    ? parseJsonOutput(result.stdout)
    : undefined;
  const details = commandDetails("mise", params.action, ["mise", ...args], result);
  return {
    content: [{ type: "text", text: formatCommandResult(details, data) }],
    details,
  };
}
