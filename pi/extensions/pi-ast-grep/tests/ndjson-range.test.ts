import assert from "node:assert/strict";
import test from "node:test";
import { parseNdjson, NdjsonParseError } from "../src/ast-grep/ndjson.js";
import { sourceRange } from "../src/ast-grep/raw.js";

test("parseNdjson handles BOM, CRLF, and blank lines", () => {
  assert.deepEqual(parseNdjson('\uFEFF{"a":1}\r\n\r\n {"b":2}\n'), [{ a: 1 }, { b: 2 }]);
});

test("parseNdjson reports line numbers and record limits", () => {
  assert.throws(() => parseNdjson('{"a":1}\nnope\n'), (error) => {
    assert.ok(error instanceof NdjsonParseError);
    assert.equal(error.line, 2);
    return true;
  });
  assert.throws(() => parseNdjson('{"a":1}\n{"b":2}', { maxRecords: 1 }), /record limit 1 exceeded/u);
  assert.throws(() => parseNdjson("[]"), /expected a JSON object/u);
});

test("sourceRange normalizes byteOffset and preserves half-open positions", () => {
  const range = sourceRange({
    byteOffset: { start: 58, end: 71 },
    start: { line: 2, column: 2 },
    end: { line: 2, column: 15 },
  });
  assert.deepEqual(range, {
    bytes: { start: 58, end: 71 },
    start: { line: 2, column: 2 },
    end: { line: 2, column: 15 },
  });
  assert.throws(() => sourceRange({
    byteOffset: { start: 8, end: 7 },
    start: { line: 0, column: 0 },
    end: { line: 0, column: 1 },
  }), /end precedes start/u);
});
