import type { ExecOptions, ExecResult } from "@earendil-works/pi-coding-agent";

/** Minimal argv-based subset of Pi's ExtensionAPI used by the client. */
export interface ExecAdapter {
  exec(command: string, args: string[], options?: ExecOptions): Promise<ExecResult>;
}

export type { ExecOptions, ExecResult };
