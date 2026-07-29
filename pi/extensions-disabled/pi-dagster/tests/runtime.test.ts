import { describe, expect, it, vi } from "vitest";
import { createRuntime } from "../src/runtime.ts";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

function fakePi(): ExtensionAPI {
  return {
    getFlag: () => undefined,
  } as unknown as ExtensionAPI;
}

describe("createRuntime", () => {
  it("shutdown is idempotent and drops client", async () => {
    const runtime = createRuntime(fakePi());
    expect(runtime.closed).toBe(false);
    runtime.watches.set("run-1", {
      handle: {
        id: "run-1",
        kind: "run_logs",
        startedAt: Date.now(),
        status: "active",
      },
      stop: () => {},
      recent: [],
    });

    runtime.upsertProfile({
      name: "local",
      graphqlHttp: "http://localhost:3000/graphql",
    });
    runtime.setActiveProfile("local");

    const fetchImpl = vi.fn(async () =>
      new Response(JSON.stringify({ data: { version: "1" } }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );
    // Ensure client via ensureClient then patch — ensureClient creates real fetch client.
    // Instead, set ephemeral and mock global fetch.
    vi.stubGlobal("fetch", fetchImpl);
    const client = await runtime.ensureClient();
    expect(client.endpoint).toContain("/graphql");
    expect(runtime.getClient()).not.toBeNull();

    runtime.shutdown();
    expect(runtime.closed).toBe(true);
    expect(runtime.watches.size).toBe(0);
    expect(runtime.getClient()).toBeNull();
    runtime.shutdown();
    expect(runtime.closed).toBe(true);
    vi.unstubAllGlobals();
  });

  it("markToolsLoaded accumulates", () => {
    const runtime = createRuntime(fakePi());
    runtime.markToolsLoaded(["dagster_inspect_asset"]);
    runtime.markToolsLoaded(["dagster_inspect_run", "dagster_inspect_asset"]);
    expect(runtime.getLoadedLazyTools().sort()).toEqual([
      "dagster_inspect_asset",
      "dagster_inspect_run",
    ]);
  });

  it("getProfilePath uses CONFIG_DIR_NAME via profiles helper", async () => {
    const { CONFIG_DIR_NAME } = await import("@earendil-works/pi-coding-agent");
    const runtime = createRuntime(fakePi());
    expect(runtime.getProfilePath("/x")).toContain(CONFIG_DIR_NAME);
  });

  it("ephemeral overrides and effective policy", () => {
    const runtime = createRuntime(fakePi());
    runtime.upsertProfile({
      name: "p",
      graphqlHttp: "http://localhost:3000/graphql",
      policy: "allowMutations",
    });
    runtime.setActiveProfile("p");
    expect(runtime.getEffectivePolicy()).toBe("allowMutations");
    runtime.setEphemeralReadOnly(true);
    expect(runtime.getEffectivePolicy()).toBe("readOnly");
    runtime.setEphemeralGraphqlUrl("http://other:9/graphql");
    expect(runtime.getEphemeralGraphqlUrl()).toBe("http://other:9/graphql");
    expect(runtime.getClient()).toBeNull(); // invalidate on override
  });

  it("routes background status changes through the current session UI sink", () => {
    const runtime = createRuntime(fakePi());
    const statuses: Array<[string, string | undefined]> = [];
    runtime.setStatusSink((key, text) => statuses.push([key, text]));
    runtime.upsertProfile({
      name: "local",
      graphqlHttp: "http://localhost:3000/graphql",
    });
    runtime.setActiveProfile("local");

    expect(statuses.at(-1)).toEqual(["dagster", "dagster:local"]);
    runtime.shutdown();
    expect(statuses.at(-1)).toEqual(["dagster", undefined]);
  });

  it("rememberEntity keeps last 3", () => {
    const runtime = createRuntime(fakePi());
    runtime.rememberEntity("asset", "a");
    runtime.rememberEntity("run", "r1");
    runtime.rememberEntity("job", "j");
    runtime.rememberEntity("asset", "b");
    expect(runtime.getRecentEntities()).toHaveLength(3);
    expect(runtime.getRecentEntities()[0]).toEqual({ kind: "asset", id: "b" });
  });

  it("incident state is bounded, defensive, and reconstructable", () => {
    const runtime = createRuntime(fakePi());
    runtime.recordIncident({
      runId: "r1",
      hypothesis: `password=hunter2 ${"x".repeat(1000)}`,
      entityIds: { runIds: Array.from({ length: 100 }, (_, i) => `r${i}`) },
    });
    const first = runtime.getIncidentSnapshot();
    expect(first.hypothesis).not.toContain("hunter2");
    expect(first.hypothesis!.length).toBeLessThanOrEqual(501);
    expect(first.entityIds.runIds.length).toBeLessThanOrEqual(50);
    first.entityIds.runIds.push("mutated");
    expect(runtime.getIncidentSnapshot().entityIds.runIds).not.toContain("mutated");

    runtime.reconstructIncident([{ type: "custom", customType: "dagster.incident", data: {
      runId: "restored", evidencePointer: "/tmp/redacted.json", entityIds: { runIds: ["restored"] },
    } }]);
    expect(runtime.getIncidentSnapshot().runId).toBe("restored");
  });

  it("runDg uses injected runner and path lookup", async () => {
    const runtime = createRuntime(fakePi());
    runtime.setDgPathLookupForTests(async (bin) => bin === "dg");
    runtime.setDgRunnerForTests(async ({ argv }) => ({
      exitCode: 0,
      signal: null,
      stdout: `ok ${argv.join(" ")}`,
      stderr: "",
      durationMs: 1,
    }));
    const result = await runtime.runDg({
      args: ["list", "defs"],
      cwd: "/tmp",
    });
    expect(result.exitCode).toBe(0);
    expect(result.argv[0]).toBe("dg");
    expect(result.stdout).toContain("list defs");
  });

  it("getDgDevState defaults to stopped", () => {
    const runtime = createRuntime(fakePi());
    expect(runtime.getDgDevState().status).toBe("stopped");
  });
});
