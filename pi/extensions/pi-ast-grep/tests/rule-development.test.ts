import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import test from "node:test";
import { join } from "node:path";
import { AstGrepClient, AstGrepClientError } from "../src/ast-grep/client.js";
import type { ExecAdapter, ExecOptions, ExecResult } from "../src/ast-grep/exec.js";
import { buildProjectRuleDiscoveryArgv, buildRuleTestArgv } from "../src/ast-grep/argv.js";
import { testConfig } from "./helpers.js";

const config = (sgConfigPath?: string) => testConfig(sgConfigPath === undefined ? {} : { sgConfigPath, discoverSgConfig: true });

class RuleTestExec implements ExecAdapter {
  cwd?: string;

  async exec(_command: string, args: string[], options: ExecOptions = {}): Promise<ExecResult> {
    if (options.cwd !== undefined) this.cwd = options.cwd;
    assert.deepEqual(args, buildRuleTestArgv({ configPath: "sgconfig.yml", testDir: "rule-tests" }));
    const cwd = options.cwd!;
    assert.match(await readFile(join(cwd, "rules", "candidate.yml"), "utf8"), /id: find-foo/u);
    const fixtures = JSON.parse(await readFile(join(cwd, "rule-tests", "candidate-test.yml"), "utf8")) as {
      id: string;
      valid: string[];
      invalid: string[];
    };
    assert.deepEqual(fixtures, { id: "find-foo", valid: ["bar(1)"], invalid: ["foo(1)"] });
    return {
      stdout: "Running 1 tests\n\n----------- Case Details -----------\nPASS find-foo  ..\n\ntest result: ok. 1 passed; 0 failed;\n",
      stderr: "",
      code: 0,
      killed: false,
    };
  }
}

test("client tests a rule in a cleaned-up isolated project", async () => {
  const exec = new RuleTestExec();
  const client = new AstGrepClient(exec, config());
  const result = await client.testRule({
    ruleId: "find-foo",
    ruleYaml: "id: find-foo\nlanguage: TypeScript\nrule:\n  pattern: foo($A)\n",
    valid: ["bar(1)"],
    invalid: ["foo(1)"],
  });
  assert.equal(result.status, "passed");
  assert.ok(result.fixtures.every((fixture) => fixture.passed));
  assert.equal(result.operation.kind, "rule-test");
  assert.equal(result.operation.outcome, "success");
  assert.ok(exec.cwd);
  await assert.rejects(access(exec.cwd!));
});

test("client returns invalid rule diagnostics and requires both fixture kinds", async () => {
  const exec: ExecAdapter = {
    exec: async () => ({
      stdout: "",
      stderr: "Error: Cannot parse rule rules/candidate.yml\n\nunknown field `nonsense`",
      code: 8,
      killed: false,
    }),
  };
  const client = new AstGrepClient(exec, config());
  const result = await client.testRule({
    ruleId: "bad",
    ruleYaml: "id: bad\nlanguage: TypeScript\nrule:\n  nonsense: x\n",
    valid: ["bar(1)"],
    invalid: ["foo(1)"],
  });
  assert.equal(result.status, "invalid");
  assert.equal(result.operation.outcome, "invalid");
  assert.equal(result.diagnostics[0]?.severity, "error");

  await assert.rejects(
    client.testRule({ ruleId: "x", ruleYaml: "id: x", valid: [], invalid: ["x"] }),
    (error) => error instanceof AstGrepClientError && error.kind === "validation" && /valid/u.test(error.message),
  );
});

test("project rules without sgconfig get a distinct configuration error", async () => {
  const client = new AstGrepClient({
    exec: async () => assert.fail("discovery must not execute without sgconfig"),
  }, config());
  await assert.rejects(
    client.discoverProjectRules({ cwd: "/work/project" }),
    (error) =>
      error instanceof AstGrepClientError
      && error.kind === "validation"
      && /no sgconfig/u.test(error.message),
  );
});

test("project rule discovery is non-interactive and source-scan-free", async () => {
  const sgConfigPath = "/work/project/sgconfig.yml";
  const calls: string[][] = [];
  const exec: ExecAdapter = {
    exec: async (_command, args) => {
      calls.push(args);
      return {
        stdout: "",
        stderr: [
          "sg: summary|project: isProject=true,projectDir=",
          "sg: entity|rule|find-foo: finalSeverity=Warning",
          "sg: summary|file: scannedFileCount=0,skippedFileCount=0",
          "sg: summary|rule: effectiveRuleCount=1,skippedRuleCount=2",
        ].join("\n"),
        code: 0,
        killed: false,
      };
    },
  };
  const client = new AstGrepClient(exec, config(sgConfigPath));
  const result = await client.discoverProjectRules({
    cwd: "/work/project",
    ruleFilter: "^find-",
  });
  assert.deepEqual(result.rules, [{ id: "find-foo", severity: "warning" }]);
  assert.equal(result.skippedRuleCount, 2);
  assert.deepEqual(calls[0], buildProjectRuleDiscoveryArgv({
    cwd: "/work/project",
    sgConfigPath,
    ruleFilter: "^find-",
  }));
  assert.ok(calls[0]?.includes("!**/*"));
});
