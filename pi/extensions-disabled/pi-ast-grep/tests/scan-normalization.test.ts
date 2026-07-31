import assert from "node:assert/strict";
import test from "node:test";
import { normalizeSearchRecord } from "../src/ast-grep/raw.js";

const range = {
  byteOffset: { start: 10, end: 16 },
  start: { line: 0, column: 10 },
  end: { line: 0, column: 16 },
};

test("scan JSON preserves finding metadata and read-only replacement preview", () => {
  const match = normalizeSearchRecord({
    text: "foo(1)", range, file: "/p/a.ts", lines: "const x = foo(1)",
    charCount: { leading: 10, trailing: 0 }, language: "TypeScript",
    metaVariables: { single: {}, multi: {}, transformed: {} },
    ruleId: "find-foo", severity: "warning", message: "found foo", note: "use bar",
    labels: [{ text: "1", range: {
      byteOffset: { start: 14, end: 15 }, start: { line: 0, column: 14 }, end: { line: 0, column: 15 },
    }, message: "argument", style: "primary" }],
    replacement: "bar(1)", replacementOffsets: { start: 10, end: 16 },
  }, "/p");
  assert.equal(match.ruleId, "find-foo");
  assert.equal(match.severity, "warning");
  assert.equal(match.labels?.[0]?.range.bytes.start, 14);
  assert.equal(match.replacement, "bar(1)");
  assert.deepEqual(match.replacementOffsets, { start: 10, end: 16 });
  assert.deepEqual(match.range.bytes, { start: 10, end: 16 });
});

test("scan JSON treats null optional string metadata as absent", () => {
  // Shape matches ast-grep 0.44.1 `scan --json=compact` when a rule omits note.
  const match = normalizeSearchRecord({
    text: "foo(1)",
    range,
    file: "/p/a.ts",
    lines: "const x = foo(1)",
    charCount: { leading: 10, trailing: 0 },
    replacement: "bar(1)",
    replacementOffsets: { start: 10, end: 16 },
    language: "TypeScript",
    metaVariables: {
      single: {
        A: {
          text: "1",
          range: {
            byteOffset: { start: 14, end: 15 },
            start: { line: 0, column: 14 },
            end: { line: 0, column: 15 },
          },
        },
      },
      multi: {},
      transformed: {},
    },
    ruleId: "find-foo",
    severity: "warning",
    note: null,
    message: "found foo",
    labels: [{ text: "foo(1)", range, style: "primary" }],
  }, "/p");
  assert.equal(match.note, undefined);
  assert.equal(match.message, "found foo");
  assert.equal(match.ruleId, "find-foo");
  assert.equal(match.replacement, "bar(1)");
  assert.equal(match.labels?.[0]?.style, "primary");
});

test("scan JSON still rejects non-string non-null optional metadata", () => {
  assert.throws(
    () => normalizeSearchRecord({
      text: "foo(1)", range, file: "/p/a.ts", lines: "const x = foo(1)",
      charCount: { leading: 10, trailing: 0 }, language: "TypeScript",
      metaVariables: { single: {}, multi: {}, transformed: {} },
      note: 42,
    }, "/p"),
    /Invalid ast-grep JSON at \$\.note: expected string/u,
  );
});
