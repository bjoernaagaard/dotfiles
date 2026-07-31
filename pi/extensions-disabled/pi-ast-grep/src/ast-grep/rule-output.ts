import type {
  ProjectRule,
  RuleFixtureResult,
  RuleTestStatus,
} from "../domain.js";

export interface ParsedRuleTestOutput {
  readonly status: RuleTestStatus;
  readonly fixtures: readonly RuleFixtureResult[];
  readonly passedRuleCount: number;
  readonly failedRuleCount: number;
  readonly configurationMissing: boolean;
}

export interface ParsedProjectRules {
  readonly rules: readonly ProjectRule[];
  readonly effectiveRuleCount: number;
  readonly skippedRuleCount: number;
  readonly diagnosticsText: string;
}

/** Parse ast-grep 0.44.1's compact fixture markers: '.' pass, N noisy valid, M missing invalid. */
export function parseRuleTestOutput(
  stdout: string,
  stderr: string,
  exitCode: number,
  valid: readonly string[],
  invalid: readonly string[],
): ParsedRuleTestOutput {
  const markerMatch = /^(?:PASS|FAIL)\s+.+?\s{2,}([.NM]+)\s*$/mu.exec(stdout);
  const markers = markerMatch?.[1] ?? "";
  const configurationMissing = /Configuration not found!/u.test(stdout);
  const expectedCount = valid.length + invalid.length;
  const markersUsable = markers.length === expectedCount;
  const fixtures: RuleFixtureResult[] = [];

  for (let index = 0; index < valid.length; index += 1) {
    const code = markersUsable ? markers[index] ?? "?" : "?";
    fixtures.push({
      expectation: "valid",
      index,
      code,
      passed: code === ".",
      source: valid[index]!,
      ...(code === "N" ? { failure: "noisy" as const } : code === "." ? {} : { failure: "not-run" as const }),
    });
  }
  for (let index = 0; index < invalid.length; index += 1) {
    const code = markersUsable ? markers[valid.length + index] ?? "?" : "?";
    fixtures.push({
      expectation: "invalid",
      index,
      code,
      passed: code === ".",
      source: invalid[index]!,
      ...(code === "M" ? { failure: "missing" as const } : code === "." ? {} : { failure: "not-run" as const }),
    });
  }

  const totals = /(?:test result: ok\.|Error: test failed\.)\s+(\d+) passed;\s+(\d+) failed;/u.exec(`${stdout}\n${stderr}`);
  const passedRuleCount = Number.parseInt(totals?.[1] ?? "0", 10);
  const failedRuleCount = Number.parseInt(totals?.[2] ?? "0", 10);
  const allFixturesPassed = fixtures.length === expectedCount && fixtures.every((fixture) => fixture.passed);
  const status: RuleTestStatus = configurationMissing || !markersUsable || ![0, 4].includes(exitCode)
    ? "invalid"
    : exitCode === 0 && allFixturesPassed
      ? "passed"
      : "failed";

  return { status, fixtures, passedRuleCount, failedRuleCount, configurationMissing };
}

/** Separate `--inspect=entity` rule records from real stderr diagnostics. */
export function parseProjectRuleDiscovery(stderr: string): ParsedProjectRules {
  const rules: ProjectRule[] = [];
  const diagnostics: string[] = [];
  let effectiveRuleCount = 0;
  let skippedRuleCount = 0;

  for (const line of stderr.split(/\r?\n/u)) {
    const rule = /^sg: entity\|rule\|(.+): finalSeverity=([^\s]+)\s*$/u.exec(line);
    if (rule !== null) {
      rules.push({ id: rule[1]!, severity: rule[2]!.toLowerCase() });
      continue;
    }
    const summary = /^sg: summary\|rule: effectiveRuleCount=(\d+),skippedRuleCount=(\d+)\s*$/u.exec(line);
    if (summary !== null) {
      effectiveRuleCount = Number.parseInt(summary[1]!, 10);
      skippedRuleCount = Number.parseInt(summary[2]!, 10);
      continue;
    }
    if (line.startsWith("sg: summary|")) continue;
    if (line.trim() !== "") diagnostics.push(line);
  }

  rules.sort((left, right) => left.id.localeCompare(right.id));
  return { rules, effectiveRuleCount, skippedRuleCount, diagnosticsText: diagnostics.join("\n") };
}
