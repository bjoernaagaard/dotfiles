import { describe, expect, it, vi } from "vitest";
import {
  createFakeWsClient,
  createWsClient,
  resolveGraphqlWsUrl,
} from "../src/clients/ws.ts";

describe("resolveGraphqlWsUrl", () => {
  it("prefers explicit graphqlWs", () => {
    expect(
      resolveGraphqlWsUrl({
        graphqlWs: "wss://example.com/graphql",
        graphqlHttp: "https://other/graphql",
      }),
    ).toBe("wss://example.com/graphql");
  });

  it("derives ws from http", () => {
    expect(
      resolveGraphqlWsUrl({ graphqlHttp: "http://localhost:3000/graphql" }),
    ).toBe("ws://localhost:3000/graphql");
  });

  it("derives wss from https and path", () => {
    expect(
      resolveGraphqlWsUrl({ graphqlHttp: "https://dagster.example/graphql" }),
    ).toBe("wss://dagster.example/graphql");
  });

  it("uses ephemeral url", () => {
    expect(
      resolveGraphqlWsUrl({
        ephemeralUrl: "http://127.0.0.1:3000/graphql",
      }),
    ).toBe("ws://127.0.0.1:3000/graphql");
  });
});

describe("createFakeWsClient", () => {
  it("delivers events and stop is idempotent", async () => {
    const client = createFakeWsClient({
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
    });

    const events: unknown[] = [];
    const { stop } = await client.subscribe({
      query: "subscription { x }",
      onNext: (d) => events.push(d),
    });

    client.last?.push({ hello: 1 });
    expect(events).toEqual([{ hello: 1 }]);
    stop();
    stop(); // idempotent
    client.close();
    client.close();
  });

  it("abort stops subscription", async () => {
    const stopFn = vi.fn();
    const client = createFakeWsClient({
      onSubscribe: () => ({
        push: () => {},
        error: () => {},
        complete: () => {},
        stop: stopFn,
      }),
    });
    const ac = new AbortController();
    await client.subscribe({
      query: "subscription { x }",
      signal: ac.signal,
      onNext: () => {},
    });
    ac.abort();
    expect(stopFn).toHaveBeenCalled();
  });
});

describe("createWsClient close", () => {
  it("close is idempotent without connect", () => {
    const client = createWsClient({
      url: "ws://example.test/graphql",
      createClientImpl: () => {
        throw new Error("should not create until subscribe");
      },
    });
    client.close();
    client.close();
  });
});
