import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import type { ExecAdapter, ExecOptions, ExecResult } from "./exec.js";

/** Argv-only adapter around Pi's cancellable process runner. */
export class PiExecAdapter implements ExecAdapter {
  readonly #pi: Pick<ExtensionAPI, "exec">;

  constructor(pi: Pick<ExtensionAPI, "exec">) {
    this.#pi = pi;
  }

  exec(command: string, args: string[], options?: ExecOptions): Promise<ExecResult> {
    return this.#pi.exec(command, [...args], options);
  }
}
