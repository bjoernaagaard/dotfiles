import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import astGrepExtension from "../extensions/ast-grep/index.js";
import { AST_GREP_STATUS_KEY, setAstGrepStatus } from "../src/status.js";

function extensionHarness(result = { stdout: "", stderr: "", code: 0, killed: false }) {
  const tools: Array<Record<string, any>> = [];
  const commands: string[] = [];
  const handlers = new Map<string, Function>();
  const events: Array<{ name: string; value: unknown }> = [];
  const fake = {
    exec: async () => result,
    registerTool: (tool: Record<string, unknown>) => tools.push(tool),
    registerCommand: (name: string) => commands.push(name),
    on: (name: string, handler: Function) => handlers.set(name, handler),
    events: { emit: (name: string, value: unknown) => events.push({ name, value }) },
  } as unknown as ExtensionAPI;
  astGrepExtension(fake);
  return { tools, commands, handlers, events };
}

test("extension exposes direct preview/apply surfaces and removes ceremony tools and commands", () => {
  const { tools, commands } = extensionHarness();
  assert.deepEqual(tools.map((tool) => tool.name), [
    "ast_grep_outline",
    "ast_grep_search",
    "ast_grep_inspect",
    "ast_grep_rule_test",
    "ast_grep_project_rules",
    "ast_grep_codemod_preview",
    "ast_grep_codemod_apply",
  ]);
  assert.deepEqual(commands, ["sg-review", "sg-apply", "sg-rules", "sg-status"]);
  assert.match(String(tools[5]?.description), /ephemeral.*paginated/iu);
  assert.match(String(tools[6]?.description), /exactly one subprocess/iu);
  const descriptions = tools.map((tool) => String(tool.description)).join("\n");
  assert.doesNotMatch(descriptions, /selectionId|transactionId|requires (?:project trust|interactive)/iu);
  assert.match(descriptions, /No preview, approval, snapshot, journal, rollback, undo, or recovery layer/iu);
  const schema = tools[6]?.parameters as { properties: Record<string, unknown>; additionalProperties: boolean };
  assert.deepEqual(Object.keys(schema.properties), ["queryKind", "pattern", "rewrite", "language", "inlineRule", "ruleFile", "ruleFilter", "paths", "globs"]);
  assert.equal(schema.additionalProperties, false);
  for (const forbidden of ["argv", "force", "confirm", "previewId", "selectionId", "transactionId"]) {
    assert.equal(forbidden in schema.properties, false);
  }
});

test("apply succeeds without trust or UI in print/json and emits one conservative event", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "pi-ast-grep-extension-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  for (const mode of ["print", "json"] as const) {
    const { tools, events } = extensionHarness();
    const apply = tools.find((tool) => tool.name === "ast_grep_codemod_apply")!;
    const ui = new Proxy({}, { get: () => { throw new Error("UI must not be touched"); } });
    const result = await apply.execute(
      "call",
      { queryKind: "pattern", pattern: "foo($A)", rewrite: "bar($A)", language: "ts", paths: ["src"] },
      undefined,
      undefined,
      { cwd: root, mode, hasUI: false, ui, isProjectTrusted: () => false },
    );
    assert.equal(result.details.result.outcome, "applied");
    assert.equal(result.details.result.subprocessCount, 1);
    assert.equal(events.length, 1);
    assert.deepEqual((events[0]!.value as { paths: string[] }).paths, []);
  }
});

test("status segment composes through its own key and shutdown clears only that key", async () => {
  const calls: Array<[string, string | undefined]> = [];
  const ctx = {
    hasUI: true,
    ui: {
      theme: { fg: (_color: string, text: string) => text },
      setStatus: (key: string, value: string | undefined) => calls.push([key, value]),
    },
  } as any;
  setAstGrepStatus(ctx, "ready", "ascii");
  setAstGrepStatus(ctx, undefined);
  assert.deepEqual(calls, [[AST_GREP_STATUS_KEY, "[sg]"], [AST_GREP_STATUS_KEY, undefined]]);

  const source = await import("node:fs/promises").then(({ readFile }) => readFile(new URL("../extensions/ast-grep/index.ts", import.meta.url), "utf8"));
  assert.doesNotMatch(source, /setFooter/u);
});
