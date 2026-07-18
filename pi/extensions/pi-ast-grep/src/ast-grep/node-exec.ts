import { spawn } from "node:child_process";
import type { ExecAdapter, ExecOptions, ExecResult } from "./exec.js";

/** Real argv-only spawn adapter for integration tests and release benchmarks. */
export class NodeSpawnExecAdapter implements ExecAdapter {
  readonly #maxCaptureBytes: number;
  launches = 0;

  constructor(maxCaptureBytes = 32 * 1024 * 1024) {
    if (!Number.isInteger(maxCaptureBytes) || maxCaptureBytes < 1) throw new RangeError("maxCaptureBytes must be positive");
    this.#maxCaptureBytes = maxCaptureBytes;
  }

  exec(command: string, args: string[], options: ExecOptions = {}): Promise<ExecResult> {
    this.launches += 1;
    return new Promise((resolve, reject) => {
      let settled = false;
      let killed = false;
      let stdout = "";
      let stderr = "";
      let bytes = 0;
      const child = spawn(command, [...args], {
        cwd: options.cwd,
        shell: false,
        stdio: ["ignore", "pipe", "pipe"],
      });
      const finishError = (error: unknown): void => {
        if (settled) return;
        settled = true;
        cleanup();
        reject(error);
      };
      const abort = (): void => {
        killed = true;
        child.kill("SIGTERM");
      };
      const timer = options.timeout === undefined ? undefined : setTimeout(abort, options.timeout);
      const cleanup = (): void => {
        if (timer !== undefined) clearTimeout(timer);
        options.signal?.removeEventListener("abort", abort);
      };
      const collect = (target: "stdout" | "stderr", chunk: Buffer): void => {
        bytes += chunk.length;
        if (bytes > this.#maxCaptureBytes) {
          killed = true;
          child.kill("SIGTERM");
          return;
        }
        if (target === "stdout") stdout += chunk.toString("utf8");
        else stderr += chunk.toString("utf8");
      };

      if (options.signal?.aborted) abort();
      else options.signal?.addEventListener("abort", abort, { once: true });
      child.stdout.on("data", (chunk: Buffer) => collect("stdout", chunk));
      child.stderr.on("data", (chunk: Buffer) => collect("stderr", chunk));
      child.on("error", finishError);
      child.on("close", (code, signal) => {
        if (settled) return;
        settled = true;
        cleanup();
        resolve({ stdout, stderr, code: code ?? 1, killed: killed || signal !== null });
      });
    });
  }
}
