import { access } from "node:fs/promises";
import { constants } from "node:fs";
import { join, delimiter } from "node:path";
import { spawn, type ChildProcess } from "node:child_process";
import type { CommandResult, OutputStream } from "./types.js";

export interface RunCommandOptions {
  readonly command: string;
  readonly args: readonly string[];
  readonly cwd: string;
  readonly signal?: AbortSignal;
  readonly timeoutMs: number;
  readonly maxOutputBytes: number;
  readonly onOutput?: (stream: OutputStream, chunk: string) => void;
}

class OutputCollector {
  private readonly chunks: Buffer[] = [];
  private used = 0;
  truncated = false;

  constructor(private readonly limit: number) {}

  push(chunk: Buffer): void {
    if (this.used >= this.limit) {
      this.truncated = true;
      return;
    }
    const remaining = this.limit - this.used;
    const accepted = chunk.byteLength <= remaining ? chunk : chunk.subarray(0, remaining);
    this.chunks.push(accepted);
    this.used += accepted.byteLength;
    if (accepted.byteLength !== chunk.byteLength) this.truncated = true;
  }

  text(): string {
    return Buffer.concat(this.chunks).toString("utf8");
  }
}

function killTree(child: ChildProcess): void {
  if (!child.pid) return;
  try {
    if (process.platform !== "win32") {
      process.kill(-child.pid, "SIGTERM");
      return;
    }
  } catch {
    // Fall through to killing the direct child.
  }
  try {
    child.kill("SIGTERM");
  } catch {
    // The process may have already exited.
  }
}

export async function runCommand(options: RunCommandOptions): Promise<CommandResult> {
  if (options.signal?.aborted) throw new Error(`pdx: ${options.command} was cancelled`);
  const started = performance.now();
  const stdout = new OutputCollector(options.maxOutputBytes);
  const stderr = new OutputCollector(options.maxOutputBytes);

  return new Promise<CommandResult>((resolve, reject) => {
    let killed = false;
    let timedOut = false;
    let settled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let abortHandler: (() => void) | undefined;

    const finish = (code: number | null, signal?: NodeJS.Signals | null): void => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      if (abortHandler && options.signal) options.signal.removeEventListener("abort", abortHandler);
      resolve({
        command: options.command,
        args: options.args,
        cwd: options.cwd,
        stdout: stdout.text(),
        stderr: stderr.text(),
        code,
        signal: signal ?? undefined,
        killed,
        timedOut,
        truncated: stdout.truncated || stderr.truncated,
        durationMs: Math.round(performance.now() - started),
      });
    };

    let child: ChildProcess;
    try {
      child = spawn(options.command, [...options.args], {
        cwd: options.cwd,
        shell: false,
        detached: process.platform !== "win32",
        stdio: ["ignore", "pipe", "pipe"],
      });
    } catch (error) {
      reject(error);
      return;
    }

    child.stdout?.on("data", (chunk: Buffer | string) => {
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      stdout.push(buffer);
      options.onOutput?.("stdout", buffer.toString("utf8"));
    });
    child.stderr?.on("data", (chunk: Buffer | string) => {
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      stderr.push(buffer);
      options.onOutput?.("stderr", buffer.toString("utf8"));
    });
    child.once("error", (error) => {
      if (!settled) {
        settled = true;
        if (timer) clearTimeout(timer);
        if (abortHandler && options.signal) options.signal.removeEventListener("abort", abortHandler);
        reject(error);
      }
    });
    child.once("close", finish);

    timer = setTimeout(() => {
      timedOut = true;
      killed = true;
      killTree(child);
    }, options.timeoutMs);

    abortHandler = () => {
      killed = true;
      killTree(child);
    };
    options.signal?.addEventListener("abort", abortHandler, { once: true });
  });
}

export async function findExecutable(command: string): Promise<string | undefined> {
  const pathValue = process.env.PATH ?? "";
  for (const directory of pathValue.split(delimiter)) {
    if (!directory) continue;
    const candidate = join(directory, command);
    try {
      await access(candidate, constants.X_OK);
      return candidate;
    } catch {
      // Continue searching.
    }
  }
  return undefined;
}

export function parseJsonOutput(text: string): unknown | undefined {
  const trimmed = text.trim();
  if (!trimmed) return undefined;
  try {
    return JSON.parse(trimmed) as unknown;
  } catch {
    return undefined;
  }
}

export function quoteArg(value: string): string {
  if (/^[a-zA-Z0-9_./:@%+=,-]+$/.test(value)) return value;
  return JSON.stringify(value);
}
