import { strict as assert } from "node:assert";
import { test } from "node:test";
import { deserializeState } from "../src/state.js";

test("deserializeState accepts and normalizes a versioned snapshot", () => {
  assert.deepEqual(deserializeState({
    version: 1,
    mode: "blend",
    task: "  Fix tests  ",
    completed: ["reproduced", 42],
  }), {
    version: 1,
    mode: "blend",
    task: "Fix tests",
    phase: undefined,
    completed: ["reproduced"],
    nextAction: undefined,
    blocker: undefined,
  });
});

test("deserializeState rejects unknown versions and modes", () => {
  assert.equal(deserializeState({ version: 2, mode: "blend" }), undefined);
  assert.equal(deserializeState({ version: 1, mode: "loud" }), undefined);
});
