import { describe, expect, it, vi } from "vitest";
import { createGraphqlQueryTool } from "../src/tools/always-on/graphql-query.ts";
import { createRuntime } from "../src/runtime.ts";

function mockPi() {
  return { appendEntry: vi.fn(), setStatus: vi.fn() } as never;
}

describe("dagster_graphql_query", () => {
  it("rejects mutation documents before request", async () => {
    const fetchImpl = vi.fn();
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
      const tool = createGraphqlQueryTool(runtime);
      await expect(
        tool.execute(
          "id",
          { query: "mutation { deleteRun(runId: \"x\") { __typename } }" },
          undefined,
          undefined,
          { hasUI: false } as never,
        ),
      ).rejects.toThrow(/mutation|Expected query/i);
      expect(fetchImpl).not.toHaveBeenCalled();
    } finally {
      globalThis.fetch = prev;
    }
  });

  it("rejects multi-op without operationName", async () => {
    const runtime = createRuntime(mockPi());
    runtime.upsertProfile({
      name: "dev",
      graphqlHttp: "http://localhost:3000/graphql",
      policy: "readOnly",
    });
    runtime.setActiveProfile("dev");
    const tool = createGraphqlQueryTool(runtime);
    await expect(
      tool.execute(
        "id",
        {
          query: "query Q { version } mutation M { deleteRun(runId: \"x\") { __typename } }",
        },
        undefined,
        undefined,
        { hasUI: false } as never,
      ),
    ).rejects.toThrow(/operationName/i);
  });

  it("allows multi-op when operationName selects a query", async () => {
    const fetchImpl = vi.fn(
      async () =>
        new Response(JSON.stringify({ data: { version: "1.0" } }), {
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
        policy: "readOnly",
      });
      runtime.setActiveProfile("dev");
      const tool = createGraphqlQueryTool(runtime);
      const result = await tool.execute(
        "id",
        {
          query: "query Q { version } mutation M { deleteRun(runId: \"x\") { __typename } }",
          operationName: "Q",
        },
        undefined,
        undefined,
        { hasUI: false } as never,
      );
      expect(result.details).toMatchObject({
        operationType: "query",
        operationName: "Q",
        rootFields: ["version"],
        redacted: true,
      });
      expect(JSON.stringify(result.details)).not.toMatch(/variables/i);
    } finally {
      globalThis.fetch = prev;
    }
  });

  it("rejects subscription documents", async () => {
    const runtime = createRuntime(mockPi());
    runtime.upsertProfile({
      name: "dev",
      graphqlHttp: "http://localhost:3000/graphql",
      policy: "readOnly",
    });
    runtime.setActiveProfile("dev");
    const tool = createGraphqlQueryTool(runtime);
    await expect(
      tool.execute(
        "id",
        { query: "subscription { pipelineRunLogs(runId: \"x\") { __typename } }" },
        undefined,
        undefined,
        { hasUI: false } as never,
      ),
    ).rejects.toThrow(/subscription|Expected query/i);
  });
});
