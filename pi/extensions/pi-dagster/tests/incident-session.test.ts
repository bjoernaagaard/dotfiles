import { describe, expect, it, vi } from "vitest";
import type { ExtensionAPI, ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import { createRuntime } from "../src/runtime.ts";
import { handleIncidentCommand } from "../src/modules/diagnose.ts";
import { reconstructIncidentState } from "../src/state/incident.ts";

function runtimeHarness() {
  const entries: Array<{ customType: string; data: unknown }> = [];
  const pi = {
    appendEntry: (customType: string, data: unknown) => entries.push({ customType, data }),
    getFlag: () => undefined,
  } as unknown as ExtensionAPI;
  const runtime = createRuntime(pi);
  runtime.upsertProfile({ name: "dev", graphqlHttp: "http://localhost/graphql", policy: "confirmMutations" });
  runtime.setActiveProfile("dev");
  return { runtime, entries };
}

function commandContext(overrides: Partial<ExtensionCommandContext> = {}): ExtensionCommandContext {
  return {
    hasUI: true,
    cwd: "/tmp",
    signal: new AbortController().signal,
    ui: { notify: vi.fn(async () => {}) },
    sessionManager: { getLeafId: () => "leaf-1" },
    fork: vi.fn(async () => ({ cancelled: false })),
    ...overrides,
  } as unknown as ExtensionCommandContext;
}

describe("incident session state", () => {
  it("records, shows, and clears JSON-safe state while retaining audits", async () => {
    const { runtime, entries } = runtimeHarness();
    const ctx = commandContext();
    runtime.recordAudit({
      auditId: "audit-1", ts: 1, tool: "dagster_launch_run", risk: "remote_launch",
      summary: "launched", outcome: "success", entityIds: ["run-1"],
    });
    await handleIncidentCommand('run-1 hypothesis="password=hunter2 upstream stale"', ctx, runtime);
    expect(runtime.getIncidentSnapshot().hypothesis).not.toContain("hunter2");
    await handleIncidentCommand("show", ctx, runtime);
    expect(ctx.ui.notify).toHaveBeenCalledWith(expect.stringContaining("Run: run-1"), "info");
    await handleIncidentCommand("clear", ctx, runtime);
    expect(runtime.getIncidentSnapshot().runId).toBeUndefined();
    expect(runtime.getIncidentSnapshot().auditIds).toContain("audit-1");
    expect(entries.some((entry) => entry.customType === "dagster.incident")).toBe(true);
  });

  it("reconstructs diagnosis, current audit, and legacy audit entries", () => {
    const state = reconstructIncidentState([
      { type: "message", message: { role: "toolResult", toolName: "dagster_evidence_pack", details: {
        runId: "run-1", evidencePointer: "/tmp/redacted.json",
        incident: { runId: "run-1", entityIds: { runIds: ["run-1"], assetKeys: ["a/b"], backfillIds: [] } },
      } } },
      { type: "custom", customType: "dagster.audit", data: {
        auditId: "audit-current", ts: 2, tool: "dagster_terminate_run", outcome: "success", summary: "terminated", entityIds: ["run-1"],
      } },
      { type: "custom", customType: "dagster.audit", data: {
        ts: 1, tool: "dagster_launch_run", outcome: "success", summary: "launched", entityIds: ["run-1"],
      } },
    ]);
    expect(state.runId).toBe("run-1");
    expect(state.evidencePointer).toBe("/tmp/redacted.json");
    expect(state.auditIds).toContain("audit-current");
    expect(state.auditIds.some((id) => id.startsWith("legacy-"))).toBe(true);
  });

  it("forks current leaf at position at and uses only fresh context for handoff", async () => {
    const { runtime } = runtimeHarness();
    runtime.recordIncident({ runId: "run-1", profileName: "dev", entityIds: { runIds: ["run-1"] } });
    let oldAlive = true;
    const sendMessage = vi.fn(async () => {});
    const notify = vi.fn(async () => {
      if (!oldAlive) throw new Error("stale old ctx used");
    });
    const fork = vi.fn(async (_leaf: string, options: any) => {
      oldAlive = false;
      runtime.shutdown();
      await options.withSession({ sendMessage });
      return { cancelled: false };
    });
    const ctx = commandContext({ ui: { notify } as any, fork });
    await handleIncidentCommand('fork hypothesis="upstream changed"', ctx, runtime);
    expect(fork).toHaveBeenCalledWith("leaf-1", expect.objectContaining({ position: "at" }));
    expect(sendMessage).toHaveBeenCalledWith(
      expect.objectContaining({ customType: "dagster.incident", content: expect.stringContaining("Profile: dev") }),
      { triggerTurn: false },
    );
    expect(notify).not.toHaveBeenCalled();
  });

  it("reports missing leaf, non-UI, and cancelled fork cleanly", async () => {
    const first = runtimeHarness();
    first.runtime.recordIncident({ runId: "r", hypothesis: "h", entityIds: { runIds: ["r"] } });
    const missing = commandContext({ sessionManager: { getLeafId: () => null } as any });
    await handleIncidentCommand("fork", missing, first.runtime);
    expect(missing.ui.notify).toHaveBeenCalledWith(expect.stringContaining("no leaf"), "error");

    const second = runtimeHarness();
    second.runtime.recordIncident({ runId: "r", hypothesis: "h", entityIds: { runIds: ["r"] } });
    const noUi = commandContext({ hasUI: false });
    await handleIncidentCommand("fork", noUi, second.runtime);
    expect(noUi.ui.notify).toHaveBeenCalledWith(expect.stringContaining("interactive"), "error");

    const third = runtimeHarness();
    third.runtime.recordIncident({ runId: "r", hypothesis: "h", entityIds: { runIds: ["r"] } });
    const cancelled = commandContext({ fork: vi.fn(async () => ({ cancelled: true })) });
    await handleIncidentCommand("fork", cancelled, third.runtime);
    expect(cancelled.ui.notify).toHaveBeenCalledWith(expect.stringContaining("cancelled"), "warning");
  });
});
