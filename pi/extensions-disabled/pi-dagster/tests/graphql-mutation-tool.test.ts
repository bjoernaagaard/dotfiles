import { describe, expect, it, vi } from "vitest";
import { createGraphqlMutationTool } from "../src/tools/lazy/graphql-mutation.ts";
import { createRuntime } from "../src/runtime.ts";
import { classifyMutationDocument } from "../src/policy/mutation-risk.ts";

function mockPi() {
  return { appendEntry: vi.fn(), setStatus: vi.fn() } as never;
}

describe("dagster_graphql_mutation", () => {
  it("rejects query documents and GraphQL shorthand queries", async () => {
    const runtime = createRuntime(mockPi());
    runtime.upsertProfile({
      name: "dev",
      graphqlHttp: "http://localhost:3000/graphql",
      policy: "allowMutations",
    });
    runtime.setActiveProfile("dev");
    const tool = createGraphqlMutationTool(runtime);
    await expect(
      tool.execute(
        "id",
        { mutation: "query { version }" },
        undefined,
        undefined,
        { hasUI: false } as never,
      ),
    ).rejects.toThrow(/rejects query/i);
    await expect(
      tool.execute(
        "id-2",
        { mutation: "{ deleteRun(runId: \"x\") { __typename } }" },
        undefined,
        undefined,
        { hasUI: false } as never,
      ),
    ).rejects.toThrow(/query|Expected mutation/i);
  });

  it("classifies launch mutation as remote_launch and allows under allowMutations", async () => {
    const risk = classifyMutationDocument(
      "mutation { launchRun(executionParams: $p) { __typename } }",
    );
    expect(risk).toBe("remote_launch");

    const fetchImpl = vi.fn(async () =>
      new Response(JSON.stringify({ data: { launchRun: { __typename: "LaunchRunSuccess", run: { runId: "r1", status: "QUEUED" } } } }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );
    const prev = globalThis.fetch;
    globalThis.fetch = fetchImpl as unknown as typeof fetch;
    try {
      const runtime = createRuntime(mockPi());
      runtime.upsertProfile({
        name: "dev",
        graphqlHttp: "http://localhost:3000/graphql",
        policy: "allowMutations",
      });
      runtime.setActiveProfile("dev");
      const tool = createGraphqlMutationTool(runtime);
      const result = await tool.execute(
        "id",
        {
          mutation: "mutation { launchRun(executionParams: $p) { __typename } }",
          variables: { p: {} },
        },
        undefined,
        undefined,
        { hasUI: false } as never,
      );
      expect(result.details).toMatchObject({ risk: "remote_launch", redacted: true });
    } finally {
      globalThis.fetch = prev;
    }
  });

  it("blocks under readOnly", async () => {
    const runtime = createRuntime(mockPi());
    runtime.upsertProfile({
      name: "ro",
      graphqlHttp: "http://localhost:3000/graphql",
      policy: "readOnly",
    });
    runtime.setActiveProfile("ro");
    const tool = createGraphqlMutationTool(runtime);
    await expect(
      tool.execute(
        "id",
        { mutation: "mutation { terminateRun(runId: \"x\") { __typename } }", force: true },
        undefined,
        undefined,
        { hasUI: false } as never,
      ),
    ).rejects.toThrow(/Blocked by policy/);
  });

  it("classifies alias destructive risk and omits variables from details/audit", async () => {
    const fetchImpl = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            data: { deleteRun: { __typename: "DeletePipelineRunSuccess", runId: "x" } },
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        ),
    );
    const prev = globalThis.fetch;
    globalThis.fetch = fetchImpl as unknown as typeof fetch;
    try {
      const runtime = createRuntime(mockPi());
      runtime.upsertProfile({
        name: "dev",
        graphqlHttp: "http://localhost:3000/graphql",
        policy: "allowMutations",
      });
      runtime.setActiveProfile("dev");
      const tool = createGraphqlMutationTool(runtime);
      const result = await tool.execute(
        "id",
        {
          mutation: "mutation { safe: deleteRun(runId: \"x\") { __typename } }",
          variables: { runConfig: { secrets: { password: "hunter2" } } },
          force: true,
        },
        undefined,
        undefined,
        { hasUI: false } as never,
      );
      expect(result.details).toMatchObject({
        risk: "destructive",
        rootFields: ["deleteRun"],
      });
      expect(JSON.stringify(result.details)).not.toMatch(/hunter2|runConfig|variables/);
      expect(classifyMutationDocument("mutation { safe: deleteRun(runId: \"x\") { __typename } }")).toBe(
        "destructive",
      );
    } finally {
      globalThis.fetch = prev;
    }
  });

  it("rejects query selected via operationName", async () => {
    const runtime = createRuntime(mockPi());
    runtime.upsertProfile({
      name: "dev",
      graphqlHttp: "http://localhost:3000/graphql",
      policy: "allowMutations",
    });
    runtime.setActiveProfile("dev");
    const tool = createGraphqlMutationTool(runtime);
    await expect(
      tool.execute(
        "id",
        {
          mutation: "query Q { version } mutation M { terminateRun(runId: \"x\") { __typename } }",
          operationName: "Q",
        },
        undefined,
        undefined,
        { hasUI: false } as never,
      ),
    ).rejects.toThrow(/query|Expected mutation/i);
  });
});
