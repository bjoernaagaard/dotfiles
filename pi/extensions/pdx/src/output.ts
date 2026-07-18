import type { CommandResult, PdxCommandDetails } from "./types.js";
import { quoteArg } from "./runner.js";

export function commandText(command: readonly string[]): string {
  return command.map(quoteArg).join(" ");
}

export function commandDetails(
  service: PdxCommandDetails["service"],
  action: string,
  command: readonly string[],
  result: CommandResult,
  data?: unknown,
): PdxCommandDetails {
  return {
    kind: "command",
    service,
    action,
    command,
    cwd: result.cwd,
    code: result.code,
    killed: result.killed,
    timedOut: result.timedOut,
    truncated: result.truncated,
    durationMs: result.durationMs,
    stdout: result.stdout,
    stderr: result.stderr,
    ...(data === undefined ? {} : { data }),
  };
}

function printableData(data: unknown): string {
  try {
    return JSON.stringify(data, null, 2) ?? String(data);
  } catch {
    return String(data);
  }
}

export function formatCommandResult(details: PdxCommandDetails, dataOverride?: unknown): string {
  const status = details.code === 0 ? "ok" : `exit ${details.code ?? "unknown"}`;
  const lines = [
    `${details.service} ${details.action}: ${status} (${details.durationMs}ms)`,
    `cwd: ${details.cwd}`,
  ];

  const data = dataOverride === undefined ? details.data : dataOverride;
  if (data !== undefined) {
    lines.push(printableData(data));
  } else if (details.stdout.trim()) {
    lines.push(details.stdout.trimEnd());
  }
  if (details.stderr.trim()) lines.push(`stderr:\n${details.stderr.trimEnd()}`);
  if (details.timedOut) lines.push("[command timed out]");
  if (details.killed) lines.push("[command cancelled]");
  if (details.truncated) lines.push("[output truncated by pdx]");
  return lines.join("\n");
}

export function lastLine(text: string): string {
  const lines = text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  return lines.at(-1) ?? "working";
}
