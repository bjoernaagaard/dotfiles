import { lastLine, commandDetails, formatCommandResult } from "./output.js";
import { parseJsonOutput, runCommand } from "./runner.js";
import type { PdxConfig, PdxToolDetails } from "./types.js";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";

export type PitchforkAction = "status" | "start" | "stop" | "restart" | "logs";

export interface PitchforkParams {
  readonly action: PitchforkAction;
  readonly ids?: readonly string[];
  readonly force?: boolean;
  readonly lines?: number;
}

export async function executePitchfork(
  ctx: ExtensionContext,
  params: PitchforkParams,
  config: PdxConfig,
  progress: (text: string) => void,
): Promise<{ content: [{ type: "text"; text: string }]; details: PdxToolDetails }> {
  const ids = params.ids ? [...params.ids] : [];
  const action = params.action;
  if ((action === "start" || action === "stop" || action === "restart") && ids.length === 0) {
    throw new Error(`pdx_pitchfork: '${action}' requires at least one daemon id`);
  }
  if (action === "logs" && params.lines !== undefined && (!Number.isInteger(params.lines) || params.lines < 0)) {
    throw new Error("pdx_pitchfork: lines must be a non-negative integer");
  }
  if (params.force && action !== "start") {
    throw new Error("pdx_pitchfork: force is only valid for start");
  }

  const args: string[] = [];
  switch (action) {
    case "status":
      args.push("list", "--json");
      break;
    case "logs":
      args.push("logs", "--json", "-n", String(params.lines ?? config.maxLogLines), ...ids);
      break;
    case "start":
      args.push("start", ...(params.force ? ["--force"] : []), ...ids);
      break;
    case "stop":
      args.push("stop", ...ids);
      break;
    case "restart":
      args.push("restart", ...ids);
      break;
  }

  progress(`pitchfork ${action}: running ${ids.length ? ids.join(", ") : "all daemons"}`);
  const result = await runCommand({
    command: "pitchfork",
    args,
    cwd: ctx.cwd,
    signal: ctx.signal,
    timeoutMs: config.defaultTimeoutMs,
    maxOutputBytes: config.maxOutputBytes,
    onOutput: (_stream, chunk) => progress(`pitchfork ${action}: ${lastLine(chunk)}`),
  });
  const data = parseJsonOutput(result.stdout);
  const details = commandDetails("pitchfork", action, ["pitchfork", ...args], result);
  return {
    content: [{ type: "text", text: formatCommandResult(details, data) }],
    details,
  };
}

export async function pitchforkStatus(ctx: ExtensionContext, config: PdxConfig): Promise<string> {
  const result = await runCommand({
    command: "pitchfork",
    args: ["list", "--json"],
    cwd: ctx.cwd,
    signal: ctx.signal,
    timeoutMs: config.defaultTimeoutMs,
    maxOutputBytes: config.maxOutputBytes,
  });
  const data = parseJsonOutput(result.stdout);
  const details = commandDetails("pitchfork", "status", ["pitchfork", "list", "--json"], result);
  return formatCommandResult(details, data);
}
