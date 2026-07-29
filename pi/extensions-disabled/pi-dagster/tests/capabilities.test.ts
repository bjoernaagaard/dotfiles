import { describe, expect, it, vi } from "vitest";
import {
  CAPABILITIES_TTL_MS,
  createCapabilitiesCache,
  fetchCapabilities,
  parseCapabilitiesFixture,
} from "../src/clients/capabilities.ts";
import { createGraphqlClient } from "../src/clients/graphql.ts";
import fixture from "./fixtures/graphql/capabilities.json" with { type: "json" };

describe("parseCapabilitiesFixture", () => {
  it("parses version/permissions/locations", () => {
    const snap = parseCapabilitiesFixture(fixture as never, "http://x/graphql", 1000);
    expect(snap.version).toBe("1.9.0");
    expect(snap.canBulkTerminate).toBe(true);
    expect(snap.permissions).toHaveLength(3);
    expect(snap.permissions[0]).toMatchObject({
      permission: "launch_pipeline_execution",
      value: true,
    });
    expect(snap.locations.map((l) => l.name)).toEqual(["local", "broken"]);
    expect(snap.locationErrorCount).toBe(0);
  });
});

describe("fetchCapabilities cache TTL", () => {
  it("returns cached snapshot within TTL and refreshes after", async () => {
    let calls = 0;
    const fetchImpl = vi.fn(async () => {
      calls += 1;
      return new Response(
        JSON.stringify({
          data: {
            ...fixture,
            version: `v${calls}`,
          },
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    });

    const client = createGraphqlClient({
      endpoint: "http://localhost:3000/graphql",
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    const cache = createCapabilitiesCache();
    let now = 1_000_000;

    const a = await fetchCapabilities(client, {
      cache,
      now: () => now,
      includeWorkspace: false,
    });
    expect(a.version).toBe("v1");

    now += CAPABILITIES_TTL_MS - 1;
    const b = await fetchCapabilities(client, {
      cache,
      now: () => now,
      includeWorkspace: false,
    });
    expect(b.version).toBe("v1");
    expect(calls).toBe(1);

    now += 2;
    const c = await fetchCapabilities(client, {
      cache,
      now: () => now,
      includeWorkspace: false,
    });
    expect(c.version).toBe("v2");
    expect(calls).toBe(2);

    const forced = await fetchCapabilities(client, {
      cache,
      force: true,
      now: () => now,
      includeWorkspace: false,
    });
    expect(forced.version).toBe("v3");
  });
});
