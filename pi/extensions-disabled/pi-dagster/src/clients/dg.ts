/**
 * Local `dg` CLI adapter: binary resolution, allowlist, one-shot spawn.
 * Secrets in env are never logged; free-form CLI output is redacted/truncated.
 */
import { access } from "node:fs/promises";
import { constants as fsConstants } from "node:fs";
import { delimiter, isAbsolute, join } from "node:path";
import { spawn } from "node:child_process";
import type { RiskClass } from "../policy/types.ts";
import { redactYamlish } from "../policy/redact.ts";
import {
  DEFAULT_MAX_BYTES,
  DEFAULT_MAX_LINES,
  truncateHead,
} from "@earendil-works/pi-coding-agent";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";

/** Allowlisted top-level dg subcommands (Phase 2). */
export const DG_ALLOWLIST = ["check", "list", "scaffold", "launch", "dev"] as const;
export type DgAllowlistedCommand = (typeof DG_ALLOWLIST)[number];

/**
 * Prefer option A: free-form `dg dev` is rejected from dagster_dg_command.
 * Lifecycle is owned by runtime + `/dagster-dev`.
 */
export const DG_COMMAND_REJECTS_DEV = true;

export type DgRunOptions = {
  /** Subcommand + flags only (no binary). */
  args: string[];
  cwd: string;
  env?: NodeJS.ProcessEnv;
  signal?: AbortSignal;
  /** Default varies by command class when unset at call site. */
  timeoutMs?: number;
  /** Attempt --json when allowlisted command supports it (best-effort; currently unused). */
  jsonHint?: boolean;
};

export type DgRunResult = {
  argv: string[];
  cwd: string;
  exitCode: number | null;
  signal: NodeJS.Signals | null;
  stdout: string;
  stderr: string;
  truncated: boolean;
  stdoutPath?: string;
  stderrPath?: string;
  durationMs: number;
};

export type DgResolveOptions = {
  /** Profile dgCommand: string (shell-ish) or string[]. */
  dgCommand?: string | string[] | null;
  /** Override PATH lookup (tests). */
  pathLookup?: (bin: string) => Promise<boolean>;
  /** Override PATH env. */
  pathEnv?: string;
};

export type DgSpawnRunner = (opts: {
  argv: string[];
  cwd: string;
  env: NodeJS.ProcessEnv;
  signal?: AbortSignal;
  timeoutMs: number;
}) => Promise<{
  exitCode: number | null;
  signal: NodeJS.Signals | null;
  stdout: string;
  stderr: string;
  durationMs: number;
}>;

const DEFAULT_TIMEOUT_MS: Record<string, number> = {
  check: 120_000,
  list: 60_000,
  scaffold: 180_000,
  launch: 180_000,
  dev: 120_000,
  default: 120_000,
};

export function defaultTimeoutForArgs(args: string[]): number {
  const top = args[0] ?? "default";
  return DEFAULT_TIMEOUT_MS[top] ?? DEFAULT_TIMEOUT_MS.default!;
}

/**
 * Split a simple dgCommand string carefully (no shell).
 * Supports quoted segments: `uv run dg` / `"/path/with space/dg"`.
 */
export function splitCommandString(cmd: string): string[] {
  const out: string[] = [];
  const re = /"([^"]*)"|'([^']*)'|(\S+)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(cmd)) !== null) {
    out.push(m[1] ?? m[2] ?? m[3] ?? "");
  }
  return out.filter((s) => s.length > 0);
}

export function normalizeDgCommand(
  dgCommand: string | string[] | null | undefined,
): string[] | null {
  if (dgCommand == null) return null;
  if (Array.isArray(dgCommand)) {
    const parts = dgCommand.map((s) => String(s).trim()).filter(Boolean);
    return parts.length ? parts : null;
  }
  const trimmed = dgCommand.trim();
  if (!trimmed) return null;
  return splitCommandString(trimmed);
}

async function pathHasBinary(
  bin: string,
  pathEnv: string,
): Promise<boolean> {
  if (isAbsolute(bin)) {
    try {
      await access(bin, fsConstants.X_OK);
      return true;
    } catch {
      try {
        await access(bin, fsConstants.F_OK);
        return true;
      } catch {
        return false;
      }
    }
  }
  const dirs = pathEnv.split(delimiter).filter(Boolean);
  for (const dir of dirs) {
    const candidate = join(dir, bin);
    try {
      await access(candidate, fsConstants.X_OK);
      return true;
    } catch {
      try {
        await access(candidate, fsConstants.F_OK);
        return true;
      } catch {
        // continue
      }
    }
  }
  return false;
}

/**
 * Binary resolution order:
 * 1. profile.dgCommand
 * 2. `dg` on PATH
 * 3. `uv run dg` if `uv` exists
 * 4. throw
 */
export async function resolveDgArgv(
  opts: DgResolveOptions = {},
): Promise<string[]> {
  const pathEnv = opts.pathEnv ?? process.env.PATH ?? "";
  const lookup =
    opts.pathLookup ?? ((bin: string) => pathHasBinary(bin, pathEnv));

  const fromProfile = normalizeDgCommand(opts.dgCommand);
  if (fromProfile) return fromProfile;

  if (await lookup("dg")) return ["dg"];
  if (await lookup("uv")) return ["uv", "run", "dg"];

  throw new Error(
    "Install dg (dagster-dg-cli) or set profile.dgCommand / use uv. " +
      "Looked for `dg` and `uv` on PATH.",
  );
}

/**
 * Allowlist check for top-level subcommand.
 * Rejects empty args, non-allowlisted commands, and shell-injection-ish tokens in argv[0].
 */
export function assertDgAllowlisted(args: string[]): void {
  if (!args.length) {
    throw new Error(
      "dg args must include a subcommand (check|list|scaffold|launch). Prefer /dagster-dev for dev.",
    );
  }
  const top = args[0]!;
  if (!top || /[;|&$`<>]/.test(top) || top.includes("\n") || top.includes("\0")) {
    throw new Error(`Rejected unsafe dg subcommand token: ${JSON.stringify(top)}`);
  }
  if (!(DG_ALLOWLIST as readonly string[]).includes(top)) {
    throw new Error(
      `dg subcommand "${top}" is not allowlisted. Allowed: ${DG_ALLOWLIST.join(", ")}. ` +
        (top === "plus" || top === "api"
          ? "Cloud/plus/api commands are out of scope for pi-dagster local author."
          : "Use allowlisted local commands only."),
    );
  }
  // Soft reject shell metacharacters in any arg (defense in depth — we spawn argv, not shell).
  for (const a of args) {
    if (a.includes("\0")) {
      throw new Error("Null bytes are not allowed in dg args");
    }
  }
}

/**
 * Option A: reject free-form `dev` inside dagster_dg_command.
 */
export function assertNotDevViaCommandTool(args: string[]): void {
  if (args[0] === "dev") {
    throw new Error(
      "Use `/dagster-dev` or runtime.startDgDev for `dg dev` lifecycle " +
        "(not free-form dagster_dg_command). Preferred so start/stop/readiness are tracked.",
    );
  }
}

/**
 * Risk classification for allowlisted dg args.
 * scaffold (and create-like) → local_source; else local_exec.
 */
export function classifyDgArgs(args: string[]): RiskClass {
  const top = args[0] ?? "";
  if (top === "scaffold" || top === "create") return "local_source";
  return "local_exec";
}

export function redactCliText(text: string, extraKeyPatterns?: string[]): string {
  return redactYamlish(text, extraKeyPatterns);
}

/**
 * Truncate stdout/stderr; if either is large, write full bodies to temp files.
 */
export async function truncateCliCapture(
  stdout: string,
  stderr: string,
  options?: { maxBytes?: number; maxLines?: number },
): Promise<{
  stdout: string;
  stderr: string;
  truncated: boolean;
  stdoutPath?: string;
  stderrPath?: string;
}> {
  const maxBytes = options?.maxBytes ?? DEFAULT_MAX_BYTES;
  const maxLines = options?.maxLines ?? DEFAULT_MAX_LINES;
  const combinedBytes = Buffer.byteLength(stdout, "utf8") + Buffer.byteLength(stderr, "utf8");
  const combinedLines =
    (stdout ? stdout.split(/\r?\n/).length : 0) + (stderr ? stderr.split(/\r?\n/).length : 0);

  const needTruncate =
    combinedBytes > maxBytes ||
    combinedLines > maxLines ||
    Buffer.byteLength(stdout, "utf8") > maxBytes ||
    Buffer.byteLength(stderr, "utf8") > maxBytes;

  if (!needTruncate) {
    return { stdout, stderr, truncated: false };
  }

  const dir = await mkdtemp(join(tmpdir(), "pi-dagster-dg-"));
  const stdoutPath = join(dir, "stdout.txt");
  const stderrPath = join(dir, "stderr.txt");
  await writeFile(stdoutPath, stdout, "utf8");
  await writeFile(stderrPath, stderr, "utf8");

  const outHead = truncateHead(stdout, { maxBytes: Math.floor(maxBytes / 2), maxLines: Math.floor(maxLines / 2) });
  const errHead = truncateHead(stderr, { maxBytes: Math.floor(maxBytes / 2), maxLines: Math.floor(maxLines / 2) });

  return {
    stdout: outHead.content + (outHead.truncated ? `\n[truncated; full: ${stdoutPath}]` : ""),
    stderr: errHead.content + (errHead.truncated ? `\n[truncated; full: ${stderrPath}]` : ""),
    truncated: true,
    stdoutPath,
    stderrPath,
  };
}

/**
 * Default spawn runner using node:child_process (no shell).
 * Kills process group on abort / timeout when possible.
 */
export function createDefaultSpawnRunner(): DgSpawnRunner {
  return async ({ argv, cwd, env, signal, timeoutMs }) => {
    if (!argv.length) {
      throw new Error("Empty argv for dg spawn");
    }
    const [bin, ...args] = argv;
    const started = Date.now();

    return await new Promise((resolvePromise, rejectPromise) => {
      let settled = false;
      let timedOut = false;
      let aborted = false;

      const child = spawn(bin!, args, {
        cwd,
        env,
        stdio: ["ignore", "pipe", "pipe"],
        // No shell — argv only.
        shell: false,
        // On POSIX, set detached so we can kill the group if needed.
        detached: process.platform !== "win32",
      });

      let stdout = "";
      let stderr = "";
      child.stdout?.setEncoding("utf8");
      child.stderr?.setEncoding("utf8");
      child.stdout?.on("data", (chunk: string) => {
        stdout += chunk;
      });
      child.stderr?.on("data", (chunk: string) => {
        stderr += chunk;
      });

      const killTree = (sig: NodeJS.Signals) => {
        try {
          if (process.platform !== "win32" && child.pid) {
            process.kill(-child.pid, sig);
          } else {
            child.kill(sig);
          }
        } catch {
          try {
            child.kill(sig);
          } catch {
            // ignore
          }
        }
      };

      let timer: NodeJS.Timeout | undefined;
      if (timeoutMs > 0) {
        timer = setTimeout(() => {
          timedOut = true;
          killTree("SIGTERM");
          setTimeout(() => {
            if (!settled) killTree("SIGKILL");
          }, 2000).unref?.();
        }, timeoutMs);
        timer.unref?.();
      }

      const onAbort = () => {
        aborted = true;
        killTree("SIGTERM");
        setTimeout(() => {
          if (!settled) killTree("SIGKILL");
        }, 1000).unref?.();
      };

      if (signal) {
        if (signal.aborted) onAbort();
        else signal.addEventListener("abort", onAbort, { once: true });
      }

      const finish = (
        exitCode: number | null,
        sig: NodeJS.Signals | null,
      ) => {
        if (settled) return;
        settled = true;
        if (timer) clearTimeout(timer);
        if (signal) signal.removeEventListener("abort", onAbort);

        const durationMs = Date.now() - started;
        if (aborted) {
          rejectPromise(new Error("dg command aborted"));
          return;
        }
        if (timedOut) {
          rejectPromise(
            new Error(`dg command timed out after ${timeoutMs}ms`),
          );
          return;
        }
        resolvePromise({
          exitCode,
          signal: sig,
          stdout,
          stderr,
          durationMs,
        });
      };

      child.on("error", (err) => {
        if (settled) return;
        settled = true;
        if (timer) clearTimeout(timer);
        if (signal) signal.removeEventListener("abort", onAbort);
        rejectPromise(
          new Error(
            `Failed to spawn dg (${argv.join(" ")}): ${err.message}`,
          ),
        );
      });

      child.on("close", (code, sig) => {
        finish(code, sig);
      });
    });
  };
}

export type RunDgParams = DgRunOptions & {
  /** Full binary argv prefix from resolveDgArgv. */
  dgArgv: string[];
  runner?: DgSpawnRunner;
  /** Extra redaction patterns from profile. */
  extraKeyPatterns?: string[];
  /** When true (default for tool path), reject `dev`. */
  rejectDev?: boolean;
};

/**
 * Run a one-shot allowlisted dg command.
 * - Spawn failure / abort / timeout → throw
 * - Non-zero exit with captured output → return result (caller may surface as structured)
 */
export async function runDg(params: RunDgParams): Promise<DgRunResult> {
  const args = params.args;
  assertDgAllowlisted(args);
  if (params.rejectDev !== false) {
    assertNotDevViaCommandTool(args);
  }

  if (params.signal?.aborted) {
    throw new Error("dg command aborted");
  }

  const timeoutMs = params.timeoutMs ?? defaultTimeoutForArgs(args);
  const argv = [...params.dgArgv, ...args];
  const env = { ...process.env, ...(params.env ?? {}) };
  // Never inject secrets into argv; env merge is caller responsibility.
  const runner = params.runner ?? createDefaultSpawnRunner();

  const raw = await runner({
    argv,
    cwd: params.cwd,
    env,
    signal: params.signal,
    timeoutMs,
  });

  const redactedStdout = redactCliText(raw.stdout, params.extraKeyPatterns);
  const redactedStderr = redactCliText(raw.stderr, params.extraKeyPatterns);
  const truncated = await truncateCliCapture(redactedStdout, redactedStderr);

  return {
    argv,
    cwd: params.cwd,
    exitCode: raw.exitCode,
    signal: raw.signal,
    stdout: truncated.stdout,
    stderr: truncated.stderr,
    truncated: truncated.truncated,
    stdoutPath: truncated.stdoutPath,
    stderrPath: truncated.stderrPath,
    durationMs: raw.durationMs,
  };
}

/** Public summary of argv for status tools (binary only, no env). */
export function formatDgArgvSummary(argv: string[]): string {
  return argv.join(" ");
}
