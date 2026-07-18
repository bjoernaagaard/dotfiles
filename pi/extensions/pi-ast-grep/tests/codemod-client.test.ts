import assert from "node:assert/strict";
import test from "node:test";
import { AstGrepClient, AstGrepClientError, type CodemodPreviewInput } from "../src/ast-grep/client.js";
import { buildCodemodApplyArgv } from "../src/ast-grep/argv.js";
import { PhaseProfiler } from "../src/profile.js";
import { FakeExec, testConfig } from "./helpers.js";

const RULE = "id: rename\nlanguage: TypeScript\nrule:\n  pattern: foo($A)\nfix: bar($A)\n";

const SELECTORS: readonly CodemodPreviewInput[] = [
  {
    queryKind: "pattern" as const,
    cwd: "/work/project",
    pattern: "foo($A)",
    rewrite: "bar($A)",
    language: "ts",
    paths: ["src"],
  },
  {
    queryKind: "inline_rule" as const,
    cwd: "/work/project",
    inlineRule: RULE,
    paths: ["src"],
  },
  {
    queryKind: "rule_file" as const,
    cwd: "/work/project",
    ruleFile: "rules/rename.yml",
    paths: ["src"],
  },
  {
    queryKind: "project_rules" as const,
    cwd: "/work/project",
    ruleFilter: "^rename$",
    paths: ["src"],
  },
];

test("native apply argv is closed and has exactly one -U for every selector", () => {
  const config = testConfig({ sgConfigPath: "/work/project/sgconfig.yml" });
  const inputs = [
    { queryKind: "pattern" as const, cwd: "/work/project", pattern: "foo($A)", rewrite: "bar($A)", language: "ts", paths: ["src"] },
    { queryKind: "inline_rule" as const, cwd: "/work/project", inlineRule: RULE, paths: ["src"] },
    { queryKind: "rule_file" as const, cwd: "/work/project", ruleFile: "rules/rename.yml", paths: ["src"] },
    { queryKind: "project_rules" as const, cwd: "/work/project", ruleFilter: "^rename$", paths: ["src"], sgConfigPath: config.sgConfigPath! },
  ];
  for (const input of inputs) {
    const argv = buildCodemodApplyArgv(input);
    assert.equal(argv.filter((value) => value === "-U" || value === "--update-all").length, 1);
    assert.ok(argv.includes("--"));
    assert.ok(argv.indexOf("--") < argv.length - 1);
    assert.ok(!argv.some((value) => value.startsWith("--json")));
    assert.ok(!argv.includes("--interactive"));
    assert.ok(!argv.includes("--version"));
  }
});

test("apply core launches exactly one native process and never probes or previews", async () => {
  for (const selector of SELECTORS) {
    const exec = new FakeExec();
    const profiler = new PhaseProfiler();
    const client = new AstGrepClient(exec, testConfig({ sgConfigPath: "/work/project/sgconfig.yml" }), { profiler });
    const result = await client.applyCodemod(selector);
    assert.equal(exec.calls.length, 1);
    assert.equal(result.subprocessCount, 1);
    assert.equal(result.outcome, "applied");
    assert.equal(exec.calls[0]?.command, "ast-grep");
    assert.equal(exec.calls[0]?.args.filter((value) => value === "-U").length, 1);
    assert.ok(!exec.calls[0]?.args.includes("--version"));
    assert.deepEqual(profiler.report().map((metric) => metric.phase), ["apply.exec", "apply.validate-and-build"]);
  }
});

test("apply preserves no-match, cancellation, timeout, exit, and output bounds", async () => {
  const selector = SELECTORS[0]!;
  const exec = new FakeExec();
  const client = new AstGrepClient(exec, testConfig());

  exec.result = { stdout: "", stderr: "", code: 1, killed: false };
  assert.equal((await client.applyCodemod(selector)).outcome, "no-match");
  assert.equal(exec.calls.length, 1);

  exec.result = { stdout: "", stderr: "", code: 2, killed: false };
  await assert.rejects(client.applyCodemod(selector), (error) => error instanceof AstGrepClientError && error.kind === "exit");

  exec.result = { stdout: "", stderr: "", code: 1, killed: true };
  await assert.rejects(client.applyCodemod(selector), (error) => error instanceof AstGrepClientError && error.kind === "timeout");

  const controller = new AbortController();
  controller.abort();
  await assert.rejects(
    client.applyCodemod({ ...selector, signal: controller.signal }),
    (error) => error instanceof AstGrepClientError && error.kind === "cancelled",
  );

  const bounded = new AstGrepClient(exec, testConfig({
    limits: { ...testConfig().limits, maxProcessOutputBytes: 8, maxProcessOutputLines: 10 },
  }));
  exec.result = { stdout: "too much output", stderr: "", code: 0, killed: false };
  await assert.rejects(bounded.applyCodemod(selector), /process output .* exceeds/u);
});

test("apply validation rejects irrelevant fields, NUL, escaping paths, and missing config before launch", async () => {
  const exec = new FakeExec();
  const client = new AstGrepClient(exec, testConfig());
  await assert.rejects(client.applyCodemod({ ...SELECTORS[1]!, rewrite: "bar" }), /rewrite is irrelevant/u);
  await assert.rejects(client.applyCodemod({ ...SELECTORS[0]!, pattern: "foo\0bar" }), /NUL/u);
  await assert.rejects(client.applyCodemod({ ...SELECTORS[0]!, paths: ["../outside"] }), /outside/u);
  await assert.rejects(client.applyCodemod(SELECTORS[3]!), /configured or discovered sgconfig/u);
  assert.equal(exec.calls.length, 0);
});
