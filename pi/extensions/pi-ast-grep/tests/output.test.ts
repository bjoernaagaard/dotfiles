import assert from "node:assert/strict";
import { readFile, rm, stat } from "node:fs/promises";
import { dirname } from "node:path";
import test from "node:test";
import type { SearchMatch, SearchResult } from "../src/domain.js";
import { boundOutput, formatSearch } from "../src/output.js";

function baseMatch(overrides: Partial<SearchMatch> = {}): SearchMatch {
  return {
    file: "src/a.ts",
    language: "typescript",
    range: {
      bytes: { start: 0, end: 10 },
      start: { line: 0, column: 0 },
      end: { line: 0, column: 10 },
    },
    text: "const x = 1",
    lines: "const x = 1",
    charCount: { leading: 0, trailing: 0 },
    metaVariables: { single: {}, multi: {}, transformed: {} },
    ...overrides,
  };
}

function searchOf(...matches: SearchMatch[]): SearchResult {
  return {
    matches,
    diagnostics: [],
    operation: {
      kind: "search",
      executable: "ast-grep",
      argv: [],
      startedAt: "1970-01-01T00:00:00.000Z",
      durationMs: 1,
      exitCode: 0,
      outcome: matches.length === 0 ? "no-match" : "success",
    },
  };
}

test("formatSearch prints single metavariables as $NAME",
  () => {
    const text = formatSearch(searchOf(baseMatch({
      metaVariables: {
        single: {
          A: { name: "A", text: "1" },
          B: { name: "B", text: "foo" },
        },
        multi: {},
        transformed: {},
      },
    })));
    assert.match(text, /\$A="1"/u);
    assert.match(text, /\$B="foo"/u);
  });

test("formatSearch prints multi metavariables as $$$NAME ordered list",
  () => {
    const text = formatSearch(searchOf(baseMatch({
      metaVariables: {
        single: {},
        multi: {
          ARGS: [
            { name: "ARGS", text: "a" },
            { name: "ARGS", text: "b" },
          ],
        },
        transformed: {},
      },
    })));
    assert.match(text, /\$\$\$ARGS=\["a","b"\]/u);
  });

test("formatSearch prints empty multi metavariables as empty list",
  () => {
    const text = formatSearch(searchOf(baseMatch({
      metaVariables: {
        single: {},
        multi: { ARGS: [] },
        transformed: {},
      },
    })));
    assert.match(text, /\$\$\$ARGS=\[\]/u);
  });

test("formatSearch labels transformed captures without colliding with single names",
  () => {
    const text = formatSearch(searchOf(baseMatch({
      metaVariables: {
        single: {
          NAME: { name: "NAME", text: "raw" },
        },
        multi: {},
        transformed: {
          NAME: { name: "NAME", text: "rewritten" },
        },
      },
    })));
    assert.match(text, /\$NAME="raw"/u);
    assert.match(text, /transformed:NAME="rewritten"/u);
  });

test("boundOutput leaves small output in memory", async () => {
  const output = await boundOutput("one\ntwo", { maxLines: 10, maxBytes: 100 });
  assert.equal(output.text, "one\ntwo");
  assert.equal(output.truncation.truncated, false);
  assert.equal(output.spool, undefined);
});

test("boundOutput can truncate ephemeral previews without persisting pre-images", async () => {
  const output = await boundOutput("one\ntwo\nthree", { maxLines: 1, maxBytes: 100, spoolOnTruncate: false });
  assert.equal(output.truncation.truncated, true);
  assert.equal(output.spool, undefined);
  assert.match(output.text, /truncated without persistence/u);
  assert.match(output.text, /Request another bounded page/u);
});

test("boundOutput truncates and privately spools exact full output", async (t) => {
  const full = "one\ntwo\nthree\nfour";
  const output = await boundOutput(full, { maxLines: 2, maxBytes: 100, spoolPrefix: "pi-ast-test-" });
  assert.equal(output.truncation.truncated, true);
  assert.ok(output.spool);
  const path = output.spool.path;
  t.after(() => rm(dirname(path), { recursive: true, force: true }));
  assert.equal(await readFile(path, "utf8"), full);
  assert.equal((await stat(path)).mode & 0o777, 0o600);
  assert.equal((await stat(dirname(path))).mode & 0o777, 0o700);
  assert.match(output.text, /Output truncated/u);
  assert.match(output.text, /Full output:/u);
});
