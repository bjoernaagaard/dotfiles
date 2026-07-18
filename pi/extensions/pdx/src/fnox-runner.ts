import { Buffer } from "node:buffer";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { runCommand } from "./runner.js";
import type { CommandResult, PdxConfig } from "./types.js";

// This process is launched inside `fnox exec`. It captures the target command's
// output and redacts inherited environment values before they reach Pi.
const REDACTING_RUNNER = String.raw`
const { spawn } = require("node:child_process");
const command = JSON.parse(Buffer.from(process.argv[1], "base64").toString("utf8"));
const limit = Math.max(1024, Number(process.env.PDX_OUTPUT_LIMIT || 524288));
const safeNames = new Set(["PATH", "HOME", "USER", "LOGNAME", "SHELL", "TERM", "LANG", "LC_ALL", "PWD", "OLDPWD", "TMPDIR", "TEMP", "TMP", "SHLVL", "_", "PWD"]);
const values = Object.entries(process.env)
  .filter(([name, value]) => value && !name.startsWith("PDX_") && !safeNames.has(name) && value.length >= 3)
  .map(([, value]) => value)
  .sort((a, b) => b.length - a.length);
let stdout = "";
let stderr = "";
let used = 0;
let truncated = false;
function collect(target, chunk) {
  const text = Buffer.from(chunk).toString("utf8");
  const remaining = limit - used;
  if (remaining <= 0) { truncated = true; return target; }
  const accepted = Buffer.from(text).subarray(0, remaining).toString("utf8");
  used += Buffer.byteLength(accepted);
  if (accepted.length !== text.length) truncated = true;
  return target + accepted;
}
function redact(text) {
  let result = text;
  for (const value of values) result = result.split(value).join("[REDACTED]");
  return result;
}
let child;
try {
  child = spawn(command[0], command.slice(1), { shell: false, stdio: ["ignore", "pipe", "pipe"], env: process.env });
} catch (error) {
  process.stdout.write(JSON.stringify({ code: null, stdout: "", stderr: String(error), truncated: false }));
  process.exit(127);
}
child.stdout.on("data", chunk => { stdout = collect(stdout, chunk); });
child.stderr.on("data", chunk => { stderr = collect(stderr, chunk); });
child.on("error", error => { stderr = collect(stderr, error); });
child.on("close", (code, signal) => {
  process.stdout.write(JSON.stringify({ code, signal, stdout: redact(stdout), stderr: redact(stderr), truncated }));
});
`;

interface RedactedResult {
  readonly code: number | null;
  readonly signal?: string;
  readonly stdout: string;
  readonly stderr: string;
  readonly truncated?: boolean;
}

function encodeCommand(command: readonly string[]): string {
  return Buffer.from(JSON.stringify(command), "utf8").toString("base64");
}

export async function runFnoxExec(
  ctx: ExtensionContext,
  config: PdxConfig,
  command: readonly string[],
  profile: string | undefined,
  timeoutMs: number,
  onOutput?: (text: string) => void,
): Promise<CommandResult> {
  const runnerArgs = [
    "--non-interactive",
    ...(profile ? ["-P", profile] : []),
    "exec",
    process.execPath,
    "-e",
    REDACTING_RUNNER,
    encodeCommand(command),
  ];
  const result = await runCommand({
    command: "fnox",
    args: runnerArgs,
    cwd: ctx.cwd,
    signal: ctx.signal,
    timeoutMs,
    maxOutputBytes: config.maxOutputBytes,
    onOutput: (_stream, chunk) => onOutput?.(chunk),
  });

  const parsed = (() => {
    try {
      return JSON.parse(result.stdout.trim()) as RedactedResult;
    } catch {
      return undefined;
    }
  })();

  // If the redacting runner did not produce its envelope, do not return raw
  // stdout. That is an intentional fail-closed behavior.
  if (!parsed || typeof parsed.stdout !== "string" || typeof parsed.stderr !== "string") {
    return {
      ...result,
      stdout: "",
      stderr: "pdx: fnox redacting runner did not return a safe result",
      truncated: true,
    };
  }

  return {
    ...result,
    stdout: parsed.stdout,
    stderr: [result.stderr, parsed.stderr].filter(Boolean).join("\n"),
    code: parsed.code,
    signal: parsed.signal,
    truncated: Boolean(result.truncated || parsed.truncated),
  };
}

export function assertFnoxPolicy(command: readonly string[]): void {
  const executable = command[0];
  if (!executable) throw new Error("pdx_fnox_exec: command must not be empty");
}

export function fnoxSecretCommand(name: string, profile?: string): string[] {
  return [
    "--non-interactive",
    ...(profile ? ["-P", profile] : []),
    "get",
    name,
  ];
}
