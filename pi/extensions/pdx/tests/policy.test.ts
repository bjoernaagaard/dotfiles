import { strict as assert } from "node:assert";
import { test } from "node:test";
import { assertFnoxPolicy } from "../src/fnox-runner.js";

test("fnox command validation accepts an argument-array command", () => {
  assert.doesNotThrow(() => assertFnoxPolicy(["node", "-e", "0"]));
});

test("fnox command validation rejects an empty command", () => {
  assert.throws(
    () => assertFnoxPolicy([]),
    /must not be empty/,
  );
});
