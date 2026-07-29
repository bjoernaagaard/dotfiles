import { describe, expect, it, vi } from "vitest";
import { mkdtemp, readFile, stat, writeFile, appendFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { collectGraphqlSubscription } from "../src/tools/lazy/graphql-subscribe.ts";
import { createGraphqlSubscribeTool } from "../src/tools/lazy/graphql-subscribe.ts";
import { createRuntime } from "../src/runtime.ts";

function mockPi() {
  return { appendEntry: vi.fn(), setStatus: vi.fn() } as never;
}

describe("collectGraphqlSubscription", () => {
  it("completes on server complete", async () => {
    const result = await collectGraphqlSubscription({
      maxEvents: 10,
      timeoutMs: 5_000,
      redact: (d) => d,
      subscribe: async (h) => {
        queueMicrotask(() => {
          h.onNext({ a: 1 });
          h.onComplete();
        });
        return { stop: () => {} };
      },
    });
    expect(result.completionReason).toBe("completed");
    expect(result.eventCount).toBe(1);
  });

  it("stops at max events", async () => {
    const result = await collectGraphqlSubscription({
      maxEvents: 2,
      timeoutMs: 5_000,
      redact: (d) => d,
      subscribe: async (h) => {
        queueMicrotask(() => {
          h.onNext(1);
          h.onNext(2);
          h.onNext(3);
        });
        return { stop: () => {} };
      },
    });
    expect(result.completionReason).toBe("max_events");
    expect(result.eventCount).toBe(2);
  });

  it("times out", async () => {
    const result = await collectGraphqlSubscription({
      maxEvents: 10,
      timeoutMs: 30,
      redact: (d) => d,
      subscribe: async () => ({ stop: () => {} }),
    });
    expect(result.completionReason).toBe("timeout");
  });

  it("aborts with AbortError and cleans up once", async () => {
    const stop = vi.fn();
    const ac = new AbortController();
    const p = collectGraphqlSubscription({
      maxEvents: 10,
      timeoutMs: 5_000,
      parentSignal: ac.signal,
      redact: (d) => d,
      subscribe: async () => ({ stop }),
    });
    queueMicrotask(() => ac.abort());
    await expect(p).rejects.toMatchObject({ name: "AbortError" });
    expect(stop).toHaveBeenCalled();
  });

  it("rejects on callback error (does not throw from callback)", async () => {
    await expect(
      collectGraphqlSubscription({
        maxEvents: 10,
        timeoutMs: 5_000,
        redact: (d) => d,
        subscribe: async (h) => {
          queueMicrotask(() => h.onError(new Error("boom")));
          return { stop: () => {} };
        },
      }),
    ).rejects.toThrow(/boom/);
  });

  it("redacts events and awaits overflow writes with mode 0600", async () => {
    const dir = await mkdtemp(join(tmpdir(), "pi-dagster-subtest-"));
    let path = join(dir, "events.jsonl");
    await writeFile(path, "", { encoding: "utf8", mode: 0o600 });
    const result = await collectGraphqlSubscription({
      maxEvents: 3,
      inlineEvents: 1,
      timeoutMs: 5_000,
      redact: (d) => {
        if (d && typeof d === "object") {
          return { ...(d as object), secret: "[REDACTED]" };
        }
        return d;
      },
      writeOverflowLine: async (line) => {
        await appendFile(path, line, { encoding: "utf8", mode: 0o600 });
        return path;
      },
      subscribe: async (h) => {
        queueMicrotask(() => {
          h.onNext({ secret: "hunter2", n: 1 });
          h.onNext({ secret: "hunter2", n: 2 });
          h.onNext({ secret: "hunter2", n: 3 });
          h.onComplete();
        });
        return { stop: () => {} };
      },
    });
    expect(result.eventCount).toBe(3);
    expect(result.events).toHaveLength(1);
    expect(JSON.stringify(result.events)).toContain("[REDACTED]");
    expect(JSON.stringify(result.events)).not.toContain("hunter2");
    expect(result.overflowPath).toBe(path);
    const overflow = await readFile(path, "utf8");
    expect(overflow).toContain("[REDACTED]");
    expect(overflow).not.toContain("hunter2");
    const st = await stat(path);
    expect(st.mode & 0o777).toBeLessThanOrEqual(0o600);
  });
});

describe("dagster_graphql_subscribe tool", () => {
  it("rejects query documents before WS", async () => {
    const runtime = createRuntime(mockPi());
    runtime.upsertProfile({
      name: "dev",
      graphqlHttp: "http://localhost:3000/graphql",
      policy: "readOnly",
    });
    runtime.setActiveProfile("dev");
    const tool = createGraphqlSubscribeTool(runtime);
    await expect(
      tool.execute(
        "id",
        { subscription: "query { version }" },
        undefined,
        undefined,
        { hasUI: false } as never,
      ),
    ).rejects.toThrow(/query|Expected subscription/i);
  });

  it("rejects mutation documents before WS", async () => {
    const runtime = createRuntime(mockPi());
    runtime.upsertProfile({
      name: "dev",
      graphqlHttp: "http://localhost:3000/graphql",
      policy: "readOnly",
    });
    runtime.setActiveProfile("dev");
    const tool = createGraphqlSubscribeTool(runtime);
    await expect(
      tool.execute(
        "id",
        { subscription: "mutation { deleteRun(runId: \"x\") { __typename } }" },
        undefined,
        undefined,
        { hasUI: false } as never,
      ),
    ).rejects.toThrow(/mutation|Expected subscription/i);
  });
});
