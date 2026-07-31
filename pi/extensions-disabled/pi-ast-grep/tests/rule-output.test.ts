import assert from "node:assert/strict";
import test from "node:test";
import { parseProjectRuleDiscovery, parseRuleTestOutput } from "../src/ast-grep/rule-output.js";
import { formatProjectRules, formatRuleTest } from "../src/output.js";

test("rule test output maps valid and invalid fixture markers", () => {
  const parsed = parseRuleTestOutput(
    "Running 1 tests\n\nFAIL find-foo  .N.M\n",
    "Error: test failed. 0 passed; 1 failed;\n",
    4,
    ["bar(1)", "foo(2)"],
    ["foo(1)", "bar(2)"],
  );
  assert.equal(parsed.status, "failed");
  assert.deepEqual(parsed.fixtures.map((fixture) => ({
    expectation: fixture.expectation,
    code: fixture.code,
    passed: fixture.passed,
    failure: fixture.failure,
  })), [
    { expectation: "valid", code: ".", passed: true, failure: undefined },
    { expectation: "valid", code: "N", passed: false, failure: "noisy" },
    { expectation: "invalid", code: ".", passed: true, failure: undefined },
    { expectation: "invalid", code: "M", passed: false, failure: "missing" },
  ]);
  assert.equal(parsed.passedRuleCount, 0);
  assert.equal(parsed.failedRuleCount, 1);
});

test("rule test output treats missing or malformed configurations as invalid", () => {
  const missing = parseRuleTestOutput(
    "Running 1 tests\nConfiguration not found! wrong-id\n",
    "",
    0,
    ["bar(1)"],
    ["foo(1)"],
  );
  assert.equal(missing.status, "invalid");
  assert.equal(missing.configurationMissing, true);
  assert.ok(missing.fixtures.every((fixture) => fixture.failure === "not-run"));

  const malformed = parseRuleTestOutput("", "Error: Cannot parse rule", 8, ["bar(1)"], ["foo(1)"]);
  assert.equal(malformed.status, "invalid");
});

test("project rule discovery separates entity records from diagnostics", () => {
  const parsed = parseProjectRuleDiscovery([
    "sg: summary|project: isProject=true,projectDir=",
    "sg: entity|rule|z-rule: finalSeverity=Warning",
    "sg: entity|rule|a-rule: finalSeverity=Error",
    "sg: summary|file: scannedFileCount=0,skippedFileCount=0",
    "sg: summary|rule: effectiveRuleCount=2,skippedRuleCount=1",
    "WARNING: trailing diagnostic",
  ].join("\n"));
  assert.deepEqual(parsed.rules, [
    { id: "a-rule", severity: "error" },
    { id: "z-rule", severity: "warning" },
  ]);
  assert.equal(parsed.effectiveRuleCount, 2);
  assert.equal(parsed.skippedRuleCount, 1);
  assert.equal(parsed.diagnosticsText, "WARNING: trailing diagnostic");
});

test("rule-development formatters surface fixture failures and discovered severities", () => {
  const operation = {
    kind: "rule-test" as const,
    executable: "ast-grep",
    argv: [],
    startedAt: "1970-01-01T00:00:00.000Z",
    durationMs: 1,
    exitCode: 4,
    outcome: "test-failed" as const,
  };
  const text = formatRuleTest({
    ruleId: "find-foo",
    status: "failed",
    fixtures: [{
      expectation: "invalid",
      index: 0,
      code: "M",
      passed: false,
      source: "bar(1)",
      failure: "missing",
    }],
    passedRuleCount: 0,
    failedRuleCount: 1,
    report: "FAIL find-foo  M",
    diagnostics: [],
    operation,
  });
  assert.match(text, /expected finding missing/u);
  assert.match(text, /bar\(1\)/u);

  const rules = formatProjectRules({
    rules: [{ id: "find-foo", severity: "warning" }],
    effectiveRuleCount: 1,
    skippedRuleCount: 2,
    diagnostics: [],
    operation: { ...operation, kind: "rule-discovery", exitCode: 0, outcome: "success" },
  });
  assert.match(rules, /find-foo \(warning\)/u);
  assert.match(rules, /Skipped rules: 2/u);
});
