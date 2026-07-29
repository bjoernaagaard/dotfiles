import { describe, expect, it } from "vitest";
import type { ExtensionAPI, SessionBeforeCompactEvent } from "@earendil-works/pi-coding-agent";
import { createRuntime } from "../src/runtime.ts";
import { createDagsterCompactionHandler } from "../src/modules/diagnose.ts";

function runtime() {
  const value = createRuntime({ getFlag: () => undefined } as unknown as ExtensionAPI);
  value.upsertProfile({ name: "dev", graphqlHttp: "http://localhost/graphql", policy: "confirmMutations" });
  value.setActiveProfile("dev");
  return value;
}

function event(overrides: Partial<SessionBeforeCompactEvent> = {}): SessionBeforeCompactEvent {
  return {
    type: "session_before_compact",
    branchEntries: [
      { type: "custom", id: "i", parentId: null, timestamp: "x", customType: "dagster.incident", data: {
        runId: "run-1", profileName: "dev", hypothesis: "upstream changed",
        evidencePointer: "/tmp/redacted-evidence.json",
        entityIds: { runIds: ["run-1"], assetKeys: ["a/b"], backfillIds: ["bf-1"] },
      } },
      { type: "custom", id: "a", parentId: "i", timestamp: "x", customType: "dagster.audit", data: {
        auditId: "audit-1", ts: 1, tool: "dagster_reexecute_run", outcome: "success", summary: "reexecuted run-2", entityIds: ["run-2"],
      } },
    ] as any,
    customInstructions: undefined,
    reason: "threshold",
    willRetry: false,
    signal: new AbortController().signal,
    preparation: {
      firstKeptEntryId: "keep-1",
      messagesToSummarize: [],
      turnPrefixMessages: [],
      isSplitTurn: false,
      tokensBefore: 43210,
      previousSummary: "General task: fix ingestion.\nraw logs: password=hunter2\nAuthorization: Bearer abc.def.ghi",
      fileOps: { read: new Set(["read.ts", "changed.ts"]), written: new Set(["new.ts"]), edited: new Set(["changed.ts"]) },
      settings: { enabled: true, reserveTokens: 1000, keepRecentTokens: 1000 },
    },
    ...overrides,
  };
}

describe("Dagster compaction summary", () => {
  it("preserves safe context, entities, outcomes, exact cut point, and file ops", async () => {
    const result = await createDagsterCompactionHandler(runtime())(event());
    expect(result?.compaction?.firstKeptEntryId).toBe("keep-1");
    expect(result?.compaction?.tokensBefore).toBe(43210);
    const summary = result?.compaction?.summary ?? "";
    expect(summary).toContain("General task: fix ingestion");
    expect(summary).toContain("dev / confirmMutations");
    expect(summary).toContain("run-1");
    expect(summary).toContain("a/b");
    expect(summary).toContain("bf-1");
    expect(summary).toContain("[audit-1] dagster_reexecute_run → success");
    expect(summary).toContain("/tmp/redacted-evidence.json");
    expect(summary).not.toMatch(/hunter2|abc\.def\.ghi|raw logs/i);
    const details = result?.compaction?.details as any;
    expect(details?.readFiles).toEqual(["read.ts"]);
    expect(details?.modifiedFiles).toEqual(["changed.ts", "new.ts"]);
    expect(details?.dagster?.redacted).toBe(true);
  });

  it("defers overflow retry, abort, and Dagster-only unsafe summaries", async () => {
    const handler = createDagsterCompactionHandler(runtime());
    expect(await handler(event({ reason: "overflow", willRetry: true }))).toBeUndefined();
    const controller = new AbortController();
    controller.abort();
    expect(await handler(event({ signal: controller.signal }))).toBeUndefined();
    const noGeneral = event();
    noGeneral.preparation.previousSummary = undefined;
    expect(await handler(noGeneral)).toBeUndefined();
  });

  it("persists full incident snapshot and reconstructs after compact-then-reload", async () => {
    const { reconstructIncidentState } = await import("../src/state/incident.ts");
    const { extractActiveProfileFromBranch } = await import("../src/state/session.ts");
    const result = await createDagsterCompactionHandler(runtime())(event());
    const dagster = (result?.compaction?.details as any)?.dagster;
    expect(dagster?.hypothesis).toBe("upstream changed");
    expect(dagster?.evidencePointer).toBe("/tmp/redacted-evidence.json");
    expect(dagster?.profileName).toBe("dev");
    expect(dagster?.incident?.runId).toBe("run-1");
    expect(dagster?.mutations?.[0]?.tool).toBe("dagster_reexecute_run");
    expect(dagster?.mutations?.[0]?.summary).toMatch(/reexecuted/);

    // Simulate compact-then-reload: only the compaction entry remains on the branch.
    const postCompactBranch = [
      {
        type: "compaction",
        details: result?.compaction?.details,
        summary: result?.compaction?.summary,
      },
    ];
    const reconstructed = reconstructIncidentState(postCompactBranch as any);
    expect(reconstructed.runId).toBe("run-1");
    expect(reconstructed.hypothesis).toBe("upstream changed");
    expect(reconstructed.evidencePointer).toBe("/tmp/redacted-evidence.json");
    expect(reconstructed.profileName).toBe("dev");
    expect(reconstructed.entityIds.assetKeys).toContain("a/b");
    expect(reconstructed.entityIds.backfillIds).toContain("bf-1");
    expect(reconstructed.auditIds).toContain("audit-1");
    expect(reconstructed.mutations.some((m) => m.tool === "dagster_reexecute_run")).toBe(true);
    expect(extractActiveProfileFromBranch(postCompactBranch as any)).toBe("dev");
  });

  it("redacts cookie headers in general context before compaction summary", async () => {
    const result = await createDagsterCompactionHandler(runtime())(
      event({
        preparation: {
          ...event().preparation,
          previousSummary:
            "General task: debug auth.\nCookie: sessionid=super-cookie\nSet-Cookie: sid=xyz",
        },
      } as any),
    );
    const summary = result?.compaction?.summary ?? "";
    expect(summary).toContain("General task: debug auth");
    expect(summary).not.toContain("super-cookie");
    expect(summary).not.toContain("sid=xyz");
  });
});
