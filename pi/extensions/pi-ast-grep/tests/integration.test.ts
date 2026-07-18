import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { AstGrepClient } from "../src/ast-grep/client.js";
import { NodeSpawnExecAdapter } from "../src/ast-grep/node-exec.js";
import { createEphemeralPreview } from "../src/codemod/preview.js";
import { testConfig } from "./helpers.js";

const RULE = `id: rename-foo
language: TypeScript
severity: warning
message: rename foo
rule:
  pattern: foo($A)
fix: bar($A)
`;

async function fixture(prefix: string): Promise<{ root: string; file: string; config: string }> {
  const root = await mkdtemp(join(tmpdir(), prefix));
  await mkdir(join(root, "src"));
  await mkdir(join(root, "rules"));
  const file = join(root, "src", "a.ts");
  await writeFile(file, "export const value = foo(1);\n");
  await writeFile(join(root, "rules", "rename.yml"), RULE);
  const config = join(root, "sgconfig.yml");
  await writeFile(config, "ruleDirs:\n  - rules\n");
  return { root, file, config };
}

test("real advisory preview is read-only and exposes exact current-source replacement", async (t) => {
  const f = await fixture("pi-ast-grep-preview-integration-");
  t.after(() => rm(f.root, { recursive: true, force: true }));
  const exec = new NodeSpawnExecAdapter();
  const client = new AstGrepClient(exec, testConfig());
  const before = await readFile(f.file, "utf8");
  const selector = { queryKind: "pattern" as const, pattern: "foo($A)", rewrite: "bar($A)", language: "ts", paths: ["src"] };
  const candidates = await client.previewCodemod({ cwd: f.root, ...selector });
  const preview = await createEphemeralPreview({
    cwd: f.root,
    selector,
    candidates,
    maxFiles: 10,
    maxChanges: 10,
    maxSourceBytes: 10_000,
  });
  assert.equal(preview.preview.items[0]?.before, "foo(1)");
  assert.equal(preview.preview.items[0]?.replacement, "bar(1)");
  assert.equal(await readFile(f.file, "utf8"), before);
  assert.equal(exec.launches, 1);
});

test("real native apply rewrites pattern, inline rule, rule file, and project rules with one process each", async (t) => {
  const cases = [
    {
      name: "pattern",
      selector: { queryKind: "pattern" as const, pattern: "foo($A)", rewrite: "bar($A)", language: "ts", paths: ["src"] },
    },
    {
      name: "inline",
      selector: { queryKind: "inline_rule" as const, inlineRule: RULE, paths: ["src"] },
    },
    {
      name: "rule-file",
      selector: { queryKind: "rule_file" as const, ruleFile: "rules/rename.yml", paths: ["src"] },
    },
    {
      name: "project",
      selector: { queryKind: "project_rules" as const, ruleFilter: "^rename-foo$", paths: ["src"] },
    },
  ];

  for (const item of cases) {
    const f = await fixture(`pi-ast-grep-${item.name}-integration-`);
    t.after(() => rm(f.root, { recursive: true, force: true }));
    const exec = new NodeSpawnExecAdapter();
    const config = item.name === "project" ? testConfig({ sgConfigPath: f.config }) : testConfig();
    const result = await new AstGrepClient(exec, config).applyCodemod({ cwd: f.root, ...item.selector });
    assert.equal(result.outcome, "applied", item.name);
    assert.equal(result.subprocessCount, 1, item.name);
    assert.equal(exec.launches, 1, item.name);
    assert.equal(result.operation.argv.filter((arg) => arg === "-U").length, 1, item.name);
    assert.ok(!result.operation.argv.includes("--version"), item.name);
    assert.equal(await readFile(f.file, "utf8"), "export const value = bar(1);\n", item.name);
  }
});

test("real exploration, rule discovery, and rule test still work without implicit version probes", async (t) => {
  const f = await fixture("pi-ast-grep-read-integration-");
  t.after(() => rm(f.root, { recursive: true, force: true }));
  const exec = new NodeSpawnExecAdapter();
  const plain = new AstGrepClient(exec, testConfig());
  const outline = await plain.outline({ cwd: f.root, paths: ["src"], language: "ts", items: "all", view: "digest" });
  assert.equal(outline.files[0]?.path, "src/a.ts");
  const search = await plain.search({ cwd: f.root, queryKind: "rule_file", ruleFile: "rules/rename.yml", paths: ["src"] });
  assert.equal(search.matches[0]?.replacement, "bar(1)");
  const inspected = await plain.inspect({ cwd: f.root, pattern: "foo($A)", code: "foo(2)", language: "ts", mode: "cst" });
  assert.match(inspected.queryTree, /^Debug CST:/u);
  const tested = await plain.testRule({ ruleId: "rename-foo", ruleYaml: RULE, valid: ["bar(1)"], invalid: ["foo(1)"] });
  assert.equal(tested.status, "passed");
  const project = new AstGrepClient(exec, testConfig({ sgConfigPath: f.config }));
  const rules = await project.discoverProjectRules({ cwd: f.root });
  assert.deepEqual(rules.rules, [{ id: "rename-foo", severity: "warning" }]);
  assert.ok(exec.launches >= 5);
});
