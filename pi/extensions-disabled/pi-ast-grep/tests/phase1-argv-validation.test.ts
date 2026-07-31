import assert from "node:assert/strict";
import test from "node:test";
import { buildCodemodApplyArgv, buildSearchArgv, validateArgValue } from "../src/ast-grep/argv.js";
import { AstGrepClient } from "../src/ast-grep/client.js";
import { FakeExec, testConfig } from "./helpers.js";

test("closed argv preserves option-like values and inserts a path boundary", () => {
  assert.deepEqual(buildSearchArgv({ cwd: "/work", pattern: "--", language: "ts", paths: ["src"] }), [
    "run", "--pattern=--", "--json=stream", "--color=never", "--lang", "ts", "--", "src",
  ]);
  const apply = buildCodemodApplyArgv({ cwd: "/work", pattern: "--", rewrite: "--", language: "ts", paths: ["src"] });
  assert.deepEqual(apply, ["run", "--pattern=--", "--rewrite", "--", "--lang", "ts", "-U", "--", "src"]);
  assert.equal(apply.filter((arg) => arg === "-U").length, 1);
});

test("NUL, empty values, irrelevant selector fields, and excess paths fail before exec", async () => {
  assert.throws(() => validateArgValue("value", ""), /empty/u);
  assert.throws(() => validateArgValue("value", "x\0y"), /NUL/u);
  const exec = new FakeExec();
  const client = new AstGrepClient(exec, testConfig({ limits: { ...testConfig().limits, maxPaths: 1 } }));
  await assert.rejects(client.search({ cwd: "/work", queryKind: "inline_rule", inlineRule: "id: x", language: "ts" }), /irrelevant/u);
  await assert.rejects(client.search({ cwd: "/work", pattern: "$A", language: "ts", paths: ["a", "b"] }), /path count/u);
  assert.equal(exec.calls.length, 0);
});

test("rule files and configured project rules are not trust-gated", async () => {
  const exec = new FakeExec();
  const client = new AstGrepClient(exec, testConfig({ sgConfigPath: "/work/sgconfig.yml" }));
  await client.search({ cwd: "/work", queryKind: "rule_file", ruleFile: "rules/x.yml" });
  await client.search({ cwd: "/work", queryKind: "project_rules" });
  assert.equal(exec.calls.length, 2);
});
