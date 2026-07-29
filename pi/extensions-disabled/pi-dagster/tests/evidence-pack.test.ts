import { readFile, stat } from "node:fs/promises";
import { describe, expect, it, vi } from "vitest";
import { evidencePackCore } from "../src/tools/lazy/evidence-pack.ts";
import type { DagsterRuntime } from "../src/runtime.ts";
import failed from "./fixtures/graphql/diagnose/run-failure.json" with { type: "json" };
import candidates from "./fixtures/graphql/diagnose/baseline-candidates.json" with { type: "json" };
import success from "./fixtures/graphql/diagnose/run-success.json" with { type: "json" };
import optional from "./fixtures/graphql/diagnose/optional-evidence.json" with { type: "json" };
import notFound from "./fixtures/graphql/diagnose/run-not-found.json" with { type: "json" };
import pythonError from "./fixtures/graphql/diagnose/run-python-error.json" with { type: "json" };

function fakeRuntime(handler: (opts: { operationName?: string; variables?: Record<string, unknown> }) => unknown): { runtime: DagsterRuntime; request: ReturnType<typeof vi.fn> } {
  const request = vi.fn(async (opts) => handler(opts));
  const client = { endpoint: "http://localhost/graphql", request };
  const runtime = {
    closed: false,
    activeProfileName: "dev",
    getActiveProfile: () => ({ name: "dev", redaction: { extraKeyPatterns: ["private_value"] } }),
    ensureClient: async () => client,
    rememberEntity: vi.fn(),
    recordIncident: vi.fn(),
  } as unknown as DagsterRuntime;
  return { runtime, request };
}

function successHandler(opts: { operationName?: string; variables?: Record<string, unknown> }): unknown {
  switch (opts.operationName) {
    case "DagsterDiagnoseRun": return opts.variables?.runId === "success-old" ? success : failed;
    case "DagsterDiagnoseCapturedLogs": return optional.captured;
    case "DagsterDiagnoseDependencyKeys": return optional.dependencyKeys;
    case "DagsterDiagnoseUpstream": return optional.upstream;
    case "DagsterDiagnoseLocations": return optional.locations;
    case "DagsterDiagnoseCollisions": return optional.collisions;
    case "DagsterDiagnoseBaselineCandidates": return candidates;
    default: throw new Error(`unexpected ${opts.operationName}`);
  }
}

describe("dagster_evidence_pack", () => {
  it("collects all bounded categories and redacts before output", async () => {
    const { runtime } = fakeRuntime(successHandler);
    const result = await evidencePackCore(runtime, { runId: "failed-1" });
    expect(result.details.kind).toBe("evidence_pack");
    const pack = result.details.evidence!;
    expect(pack.failures).toHaveLength(1);
    expect(pack.computeLogs[0]?.availability).toBe("available");
    expect(pack.upstream[0]?.failedChecks?.[0]?.status).toBe("FAILED");
    expect(pack.locations[0]?.error).toMatch(/\[REDACTED\]/);
    expect(pack.collisions).toHaveLength(1);
    expect(pack.baseline.runId).toBe("success-old");
    expect(JSON.stringify(result)).not.toMatch(/fixture-super-secret|log-super-secret|check-super-secret|location-super-secret/);
  });

  it.each([
    ["not_found", notFound],
    ["python_error", pythonError],
  ])("returns structured %s run lookup", async (kind, fixture) => {
    const { runtime } = fakeRuntime(() => fixture);
    const result = await evidencePackCore(runtime, { runId: "missing" });
    expect(result.details.kind).toBe(kind);
  });

  it("marks one optional query failure partial without losing core evidence", async () => {
    const { runtime } = fakeRuntime((opts) => {
      if (opts.operationName === "DagsterDiagnoseLocations") throw new Error("workspace unavailable");
      return successHandler(opts);
    });
    const result = await evidencePackCore(runtime, { runId: "failed-1" });
    expect(result.details.evidence?.partial).toBe(true);
    expect(result.details.evidence?.warnings.join(" ")).toMatch(/Location evidence unavailable/);
  });

  it("throws core transport failures", async () => {
    const { runtime } = fakeRuntime(() => { throw new Error("transport down"); });
    await expect(evidencePackCore(runtime, { runId: "failed-1" })).rejects.toThrow("transport down");
  });

  it("honors abort before bounded follow-ups", async () => {
    const controller = new AbortController();
    const { runtime, request } = fakeRuntime((opts) => {
      if (opts.operationName === "DagsterDiagnoseRun") {
        controller.abort();
        return failed;
      }
      return successHandler(opts);
    });
    await expect(evidencePackCore(runtime, { runId: "failed-1" }, controller.signal)).rejects.toMatchObject({ name: "AbortError" });
    expect(request).toHaveBeenCalledTimes(1);
  });

  it("writes only redacted bounded overflow with restrictive permissions", async () => {
    const many = structuredClone(failed) as any;
    many.runOrError.eventConnection.hasMore = true;
    const { runtime } = fakeRuntime((opts) =>
      opts.operationName === "DagsterDiagnoseRun" && opts.variables?.runId === "failed-1"
        ? many
        : successHandler(opts),
    );
    const result = await evidencePackCore(runtime, { runId: "failed-1" });
    const path = result.details.evidencePointer;
    expect(path).toBeTruthy();
    const content = await readFile(path!, "utf8");
    expect(content).not.toMatch(/fixture-super-secret|log-super-secret|check-super-secret|location-super-secret/);
    expect((await stat(path!)).mode & 0o777).toBe(0o600);
    expect(result.details.evidence?.stepEvents.length).toBeLessThanOrEqual(20);
  });

  it("represents missing capture keys as unavailable evidence", async () => {
    const noLogs = structuredClone(failed) as any;
    noLogs.runOrError.eventConnection.events = noLogs.runOrError.eventConnection.events.filter((x: any) => x.__typename !== "LogsCapturedEvent");
    const { runtime } = fakeRuntime((opts) => opts.operationName === "DagsterDiagnoseRun" ? noLogs : successHandler(opts));
    const result = await evidencePackCore(runtime, { runId: "failed-1", compareLastSuccess: false });
    expect(result.details.evidence?.computeLogs).toEqual([
      expect.objectContaining({ availability: "unavailable" }),
    ]);
  });

  it("includes bounded baseline comparison highlights", async () => {
    const { runtime } = fakeRuntime(successHandler);
    const result = await evidencePackCore(runtime, { runId: "failed-1" });
    const baseline = result.details.evidence?.baseline;
    expect(baseline?.available).toBe(true);
    expect(baseline?.runId).toBe("success-old");
    expect(baseline?.highlights).toBeTruthy();
    expect(typeof baseline?.highlights?.stepStatusChanges).toBe("number");
    expect(Array.isArray(baseline?.highlights?.sample)).toBe(true);
    expect(result.content[0]?.text ?? "").toMatch(/Baseline highlights:/);
  });

  it("paginates events and retains failure beyond the first page", async () => {
    const page1 = structuredClone(failed) as any;
    const page2 = structuredClone(failed) as any;
    // First page: only early noise, more pages available.
    page1.runOrError.eventConnection = {
      cursor: "cursor-1",
      hasMore: true,
      events: [
        {
          __typename: "ExecutionStepStartEvent",
          message: "started early",
          timestamp: "1",
          stepKey: "early",
          eventType: "STEP_START",
        },
      ],
    };
    // Second page: terminal failure + logs capture.
    page2.runOrError.eventConnection = {
      cursor: "cursor-2",
      hasMore: false,
      events: failed.runOrError.eventConnection.events,
    };

    const { runtime, request } = fakeRuntime((opts) => {
      if (opts.operationName === "DagsterDiagnoseRun") {
        if (!opts.variables?.afterCursor) return page1;
        if (opts.variables.afterCursor === "cursor-1") return page2;
        throw new Error(`unexpected cursor ${opts.variables.afterCursor}`);
      }
      return successHandler(opts);
    });

    const result = await evidencePackCore(runtime, {
      runId: "failed-1",
      compareLastSuccess: false,
      includeComputeLogs: false,
    });
    const diagnoseCalls = request.mock.calls.filter(
      (c) => c[0]?.operationName === "DagsterDiagnoseRun",
    );
    expect(diagnoseCalls.length).toBeGreaterThanOrEqual(2);
    expect(result.details.evidence?.failures.length).toBeGreaterThan(0);
    expect(result.details.evidence?.failures[0]?.message ?? "").not.toMatch(/started early/);
  });
});
