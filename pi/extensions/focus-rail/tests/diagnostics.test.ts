import { strict as assert } from "node:assert";
import { test } from "node:test";
import { diagnoseResponse } from "../src/diagnostics.js";

test("diagnostics catch policy leakage and conversational padding", () => {
  const codes = diagnoseResponse(
    "Great question! The Focus Rail says to answer directly. Hope this helps!",
  ).map((diagnostic) => diagnostic.code);
  assert.deepEqual(codes, ["policy-leak", "generic-opener", "generic-closer"]);
});

test("diagnostics leave a natural direct answer alone", () => {
  assert.deepEqual(
    diagnoseResponse("Idempotent means repeating the same operation has the same effect as doing it once."),
    [],
  );
});
