import type { AstGrepConfig } from "../src/config.js";
import { DEFAULT_LIMITS } from "../src/config.js";
import type { ExecAdapter, ExecOptions, ExecResult } from "../src/ast-grep/exec.js";

export class FakeExec implements ExecAdapter {
  readonly calls: Array<{ command: string; args: string[]; options?: ExecOptions }> = [];
  result: ExecResult = { stdout: "", stderr: "", code: 0, killed: false };

  async exec(command: string, args: string[], options?: ExecOptions): Promise<ExecResult> {
    this.calls.push({ command, args: [...args], ...(options === undefined ? {} : { options }) });
    return this.result;
  }
}

export function testConfig(overrides: Partial<AstGrepConfig> = {}): AstGrepConfig {
  return {
    executable: "ast-grep",
    limits: DEFAULT_LIMITS,
    discoverSgConfig: false,
    profile: false,
    statusStyle: "ascii",
    globalConfigPath: "/agent/ast-grep.json",
    globalConfigLoaded: false,
    projectConfigPath: "/work/project/.pi/ast-grep.json",
    projectConfigLoaded: false,
    diagnostics: [],
    ...overrides,
  };
}
