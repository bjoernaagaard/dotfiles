import { describe, expect, it, vi } from "vitest";
import { createRuntime } from "../src/runtime.ts";
import { createFakeWsClient } from "../src/clients/ws.ts";

function mockPi() {
  return { appendEntry: vi.fn(), setStatus: vi.fn() } as never;
}

describe("run log watches", () => {
  it("start/stop/list with fake WS; shutdown clears", async () => {
    const runtime = createRuntime(mockPi());
    runtime.upsertProfile({
      name: "dev",
      graphqlHttp: "http://localhost:3000/graphql",
    });
    runtime.setActiveProfile("dev");

    runtime.setWsClientFactoryForTests((url) =>
      createFakeWsClient({
        url,
        onSubscribe: () => {
          let stopped = false;
          return {
            push: () => {},
            error: () => {},
            complete: () => {},
            stop: () => {
              stopped = true;
              void stopped;
            },
          };
        },
      }),
    );

    const handle = await runtime.startRunLogWatch({ runId: "run-1" });
    expect(handle.id).toMatch(/^watch:/);
    expect(handle.runId).toBe("run-1");
    expect(handle.logPath).toBeTruthy();
    expect(runtime.listWatches()).toHaveLength(1);

    // Push a failure event
    const fake = runtime.getWsClient() as ReturnType<typeof createFakeWsClient>;
    fake.last?.push({
      pipelineRunLogs: {
        __typename: "PipelineRunLogsSubscriptionSuccess",
        cursor: "1",
        hasMorePastEvents: false,
        messages: [
          {
            __typename: "RunFailureEvent",
            message: "failed",
            runId: "run-1",
            timestamp: "1",
            level: "ERROR",
          },
        ],
      },
    });

    // allow async append
    await new Promise((r) => setTimeout(r, 20));
    const listed = runtime.listWatches();
    expect(listed[0]?.urgentFailure).toBe(true);

    runtime.stopWatch(handle.id);
    expect(runtime.listWatches()).toHaveLength(0);

    // restart and shutdown
    await runtime.startRunLogWatch({ runId: "run-2" });
    expect(runtime.listWatches()).toHaveLength(1);
    runtime.shutdown();
    expect(runtime.listWatches()).toHaveLength(0);
    expect(runtime.closed).toBe(true);
  });
});
