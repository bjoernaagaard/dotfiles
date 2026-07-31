import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createEphemeralPreview, CodemodPreviewError } from "../src/codemod/preview.js";
import { formatCodemodPreview } from "../src/output.js";
import type { CodemodCandidateResult, SearchMatch } from "../src/domain.js";

function match(file: string, start: number, end: number, before: string, replacement: string): SearchMatch {
  return {
    text: before,
    range: {
      bytes: { start, end },
      start: { line: 0, column: start },
      end: { line: 0, column: end },
    },
    file,
    lines: "foo(foo(1))",
    charCount: { leading: 0, trailing: 0 },
    language: "TypeScript",
    metaVariables: { single: {}, multi: {}, transformed: {} },
    ruleId: "rename-foo",
    severity: "warning",
    message: "replace foo",
    replacement,
    replacementOffsets: { start, end },
  };
}

function candidates(matches: SearchMatch[]): CodemodCandidateResult {
  return {
    queryKind: "inline_rule",
    matches,
    skippedWithoutFix: 1,
    diagnostics: [],
    operation: {
      kind: "codemod-preview",
      executable: "ast-grep",
      argv: ["scan", "--json=stream"],
      startedAt: "2026-01-01T00:00:00.000Z",
      durationMs: 1,
      exitCode: 0,
      outcome: "success",
    },
  };
}

test("ephemeral preview pages exact pre-images, replacements, context, metadata, and conflicts", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "pi-ast-grep-preview-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(join(root, "src"));
  await writeFile(join(root, "src", "a.ts"), "foo(foo(1))\n");
  const selector = { queryKind: "inline_rule" as const, inlineRule: "rule", paths: ["src"] };
  const all = candidates([
    match("src/a.ts", 0, 11, "foo(foo(1))", "bar(foo(1))"),
    match("src/a.ts", 4, 10, "foo(1)", "bar(1)"),
  ]);
  const first = await createEphemeralPreview({
    cwd: root,
    selector,
    candidates: all,
    page: 1,
    pageSize: 1,
    maxFiles: 10,
    maxChanges: 10,
    maxSourceBytes: 10_000,
  });
  assert.equal(first.preview.totalPages, 2);
  assert.equal(first.preview.totalChanges, 2);
  assert.equal(first.preview.conflictGroupCount, 1);
  assert.equal(first.preview.items[0]?.before, "foo(foo(1))");
  assert.equal(first.preview.items[0]?.replacement, "bar(foo(1))");
  assert.equal(first.preview.items[0]?.context, "foo(foo(1))");
  assert.equal(first.preview.items[0]?.ruleId, "rename-foo");
  assert.match(first.preview.items[0]?.conflictGroup ?? "", /^conflict-/u);
  const text = formatCodemodPreview(first);
  assert.match(text, /Advisory preview page 1\/2/u);
  assert.match(text, /Before \(11 bytes\):\nfoo\(foo\(1\)\)/u);
  assert.match(text, /Replacement \(11 bytes\):\nbar\(foo\(1\)\)/u);
  assert.match(text, /Next page: page=2/u);
  assert.match(text, /not an approval or snapshot/u);

  const second = await createEphemeralPreview({
    cwd: root,
    selector,
    candidates: all,
    page: 2,
    pageSize: 1,
    maxFiles: 10,
    maxChanges: 10,
    maxSourceBytes: 10_000,
  });
  assert.equal(second.preview.items[0]?.before, "foo(1)");
});

test("preview bounds file, change, source-byte, page, UTF-8, and root escape inputs", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "pi-ast-grep-preview-bounds-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  await writeFile(join(root, "a.ts"), "foo(1)\n");
  const selector = { queryKind: "pattern" as const, pattern: "foo($A)", rewrite: "bar($A)", language: "ts" };
  const all = candidates([match("a.ts", 0, 6, "foo(1)", "bar(1)")]);
  await assert.rejects(createEphemeralPreview({ cwd: root, selector, candidates: all, page: 2, maxFiles: 1, maxChanges: 1, maxSourceBytes: 100 }), /page 2/u);
  await assert.rejects(createEphemeralPreview({ cwd: root, selector, candidates: all, maxFiles: 1, maxChanges: 1, maxSourceBytes: 1 }), /source reads exceed/u);
  await assert.rejects(createEphemeralPreview({ cwd: root, selector, candidates: all, maxFiles: 1, maxChanges: 1, maxSourceBytes: 100, pageSize: 101 }), CodemodPreviewError);
  await assert.rejects(createEphemeralPreview({ cwd: root, selector, candidates: candidates([...all.matches, ...all.matches]), maxFiles: 1, maxChanges: 1, maxSourceBytes: 100 }), /exceeding limit/u);
  await assert.rejects(createEphemeralPreview({ cwd: root, selector, candidates: candidates([match("../outside.ts", 0, 1, "x", "y")]), maxFiles: 1, maxChanges: 1, maxSourceBytes: 100 }), /escapes project root/u);
});
