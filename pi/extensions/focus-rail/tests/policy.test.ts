import { strict as assert } from "node:assert";
import { test } from "node:test";
import { buildPolicyPrompt } from "../src/policy.js";
import { DEFAULT_STATE } from "../src/state.js";

test("blend policy stays unbranded and discourages tool narration", () => {
  const prompt = buildPolicyPrompt(DEFAULT_STATE);
  assert.match(prompt, /Do not narrate ordinary tool use/);
  assert.match(prompt, /Never name, announce, or explain this response policy/);
  assert.doesNotMatch(prompt, /ADHD/i);
});

test("strict policy adds presentation constraints", () => {
  const prompt = buildPolicyPrompt({ ...DEFAULT_STATE, mode: "strict" });
  assert.match(prompt, /Stricter presentation/);
  assert.match(prompt, /primary list to five items/);
});

test("working state is included only when present", () => {
  assert.doesNotMatch(buildPolicyPrompt(DEFAULT_STATE), /Current working state/);
  const prompt = buildPolicyPrompt({
    ...DEFAULT_STATE,
    task: "Fix callback tests",
    completed: ["Reproduced the failure"],
    blocker: "Missing sanitized response",
  });
  assert.match(prompt, /Task: Fix callback tests/);
  assert.match(prompt, /Completed: Reproduced the failure/);
  assert.match(prompt, /Known blocker: Missing sanitized response/);
});
