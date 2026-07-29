import { readFile } from "node:fs/promises";
import { describe, expect, it, vi } from "vitest";
import { compareRunCore } from "../src/tools/lazy/compare-run.ts";
import { mapDiagnosticRunOrError, selectComparableBaseline } from "../src/domain/diagnose.ts";
import type { DagsterRuntime } from "../src/runtime.ts";
import failed from "./fixtures/graphql/diagnose/run-failure.json" with { type: "json" };
import candidates from "./fixtures/graphql/diagnose/baseline-candidates.json" with { type: "json" };
import success from "./fixtures/graphql/diagnose/run-success.json" with { type: "json" };

function runtimeWith(request: (operation: string | undefined) => unknown): DagsterRuntime {
  const client = {
    endpoint: "http://localhost/graphql",
    request: vi.fn(async (opts: { operationName?: string }) => request(opts.operationName)),
  };
  return {
    closed: false,
    activeProfileName: "dev",
    getActiveProfile: () => ({ name: "dev", redaction: { extraKeyPatterns: ["private_value"] } }),
    ensureClient: async () => client,
    rememberEntity: vi.fn(),
    recordIncident: vi.fn(),
  } as unknown as DagsterRuntime;
}

describe("dagster_compare_run", () => {
  it("chooses exact baseline, excludes same lineage, and diffs redacted fields", async () => {
    const runtime = runtimeWith((operation) => {
      if (operation === "DagsterDiagnoseRun") {
        const count = (runtime.ensureClient as any).mockCount ?? 0;
        void count;
      }
      if (operation === "DagsterDiagnoseBaselineCandidates") return candidates;
      // Request order: failed current, candidates, selected baseline.
      const calls = (runtime.ensureClient as any);
      void calls;
      return undefined;
    });
    const client = await runtime.ensureClient() as any;
    client.request.mockImplementation(async (opts: { operationName?: string; variables?: Record<string, unknown> }) => {
      if (opts.operationName === "DagsterDiagnoseBaselineCandidates") return candidates;
      if (opts.operationName === "DagsterDiagnoseRun" && opts.variables?.runId === "success-old") return success;
      if (opts.operationName === "DagsterDiagnoseRun") return failed;
      throw new Error("unexpected operation");
    });

    const result = await compareRunCore(runtime, { runId: "failed-1" });
    expect(result.details.kind).toBe("comparison");
    expect(result.details.comparison?.baseline?.runId).toBe("success-old");
    expect(result.details.comparison?.changes.config).toEqual(
      expect.arrayContaining([expect.objectContaining({ path: "$.ops.load.config.batch", before: 1, after: 2 })]),
    );
    expect(result.details.comparison?.changes.steps[0]).toEqual(expect.objectContaining({ before: "SUCCESS", after: "FAILURE" }));
    expect(result.details.comparison?.changes.checks[0]).toEqual(expect.objectContaining({ before: "SUCCEEDED", after: "FAILED" }));
    expect(JSON.stringify(result)).not.toMatch(/fixture-super-secret|baseline-super-secret/);
  });

  it("returns actionable no-baseline instead of weakening partition constraints", async () => {
    const runtime = runtimeWith((operation) => {
      if (operation === "DagsterDiagnoseRun") return failed;
      if (operation === "DagsterDiagnoseBaselineCandidates") return { runsOrError: { __typename: "Runs", results: [] } };
      throw new Error("unexpected");
    });
    const result = await compareRunCore(runtime, { runId: "failed-1" });
    expect(result.details.kind).toBe("no_baseline");
    expect(result.details.comparison?.noBaselineReason).toMatch(/No comparable successful run/);
    expect(result.content[0].text).toMatch(/No comparable successful baseline/);
  });

  it("spills only redacted comparison overflow", async () => {
    const currentFixture = structuredClone(failed) as any;
    const baselineFixture = structuredClone(success) as any;
    currentFixture.runOrError.runConfig.large = Object.fromEntries(
      Array.from({ length: 500 }, (_, i) => [`field_${i}`, `${"after".repeat(30)}-${i}`]),
    );
    currentFixture.runOrError.runConfig.large.password = "current-overflow-secret";
    baselineFixture.runOrError.runConfig.large = Object.fromEntries(
      Array.from({ length: 500 }, (_, i) => [`field_${i}`, `${"before".repeat(30)}-${i}`]),
    );
    baselineFixture.runOrError.runConfig.large.password = "baseline-overflow-secret";
    const runtime = runtimeWith(() => undefined);
    const client = await runtime.ensureClient() as any;
    client.request.mockImplementation(async (opts: { operationName?: string; variables?: Record<string, unknown> }) => {
      if (opts.operationName === "DagsterDiagnoseBaselineCandidates") return candidates;
      return opts.variables?.runId === "success-old" ? baselineFixture : currentFixture;
    });
    const result = await compareRunCore(runtime, { runId: "failed-1" });
    const path = result.details.comparison?.overflowPath;
    expect(path).toBeTruthy();
    expect(result.details.comparison?.truncated).toBe(true);
    expect(await readFile(path!, "utf8")).not.toMatch(/current-overflow-secret|baseline-overflow-secret/);
  });

  it("uses end/start/run-id ordering deterministically", () => {
    const currentResult = mapDiagnosticRunOrError(failed);
    expect(currentResult.ok).toBe(true);
    if (!currentResult.ok) return;
    const baseResult = mapDiagnosticRunOrError({ runOrError: candidates.runsOrError.results[0] });
    expect(baseResult.ok).toBe(true);
    if (!baseResult.ok) return;
    const a = { ...baseResult.run, runId: "b", endTime: 10, startTime: 5 };
    const b = { ...baseResult.run, runId: "a", endTime: 10, startTime: 5 };
    expect(selectComparableBaseline(currentResult.run, [a, b]).baseline?.runId).toBe("a");
  });
});
