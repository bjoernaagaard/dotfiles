import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createGraphqlClient,
  resolveGraphqlEndpoint,
} from "../src/clients/graphql.ts";
import { interpretResolverOutput } from "../src/clients/headers.ts";
import { isDagsterError } from "../src/domain/errors.ts";
import { isMutationDocument } from "../src/tools/always-on/graphql-query.ts";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  delete process.env.PI_DAGSTER_TEST_TOKEN;
});

describe("resolveGraphqlEndpoint", () => {
  it("uses absolute path as-is", () => {
    expect(
      resolveGraphqlEndpoint({ graphqlHttp: "http://localhost:3000/graphql" }),
    ).toBe("http://localhost:3000/graphql");
  });

  it("appends /graphql for origin-only URLs", () => {
    expect(resolveGraphqlEndpoint({ graphqlHttp: "http://localhost:3000" })).toBe(
      "http://localhost:3000/graphql",
    );
  });

  it("honors ephemeral override and pathPrefix", () => {
    expect(
      resolveGraphqlEndpoint({
        graphqlHttp: "http://ignored:1",
        ephemeralUrl: "http://localhost:4000",
        pathPrefix: "/dagster",
      }),
    ).toBe("http://localhost:4000/dagster/graphql");
  });
});

describe("interpretResolverOutput", () => {
  it("maps bare token to Authorization Bearer", () => {
    expect(interpretResolverOutput("tok_abc")).toEqual({
      Authorization: "Bearer tok_abc",
    });
  });

  it("parses header lines", () => {
    expect(interpretResolverOutput("X-Api-Key: abc\nX-Other: 1")).toEqual({
      "X-Api-Key": "abc",
      "X-Other": "1",
    });
  });
});

describe("GraphqlClient.request", () => {
  it("returns data on success", async () => {
    const fetchImpl = vi.fn(async () =>
      new Response(JSON.stringify({ data: { version: "1.0" } }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );
    const client = createGraphqlClient({
      endpoint: "http://localhost:3000/graphql",
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    const data = await client.request<{ version: string }>({
      query: "{ version }",
    });
    expect(data.version).toBe("1.0");
    expect(fetchImpl).toHaveBeenCalledOnce();
  });

  it("throws on HTTP 401", async () => {
    const fetchImpl = vi.fn(async () => new Response("nope", { status: 401 }));
    const client = createGraphqlClient({
      endpoint: "http://localhost:3000/graphql",
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    await expect(client.request({ query: "{ version }" })).rejects.toSatisfy(
      (err: unknown) => isDagsterError(err) && err.kind === "unauthorized",
    );
  });

  it("throws on GraphQL errors array", async () => {
    const fetchImpl = vi.fn(async () =>
      new Response(
        JSON.stringify({ errors: [{ message: "field boom" }] }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    );
    const client = createGraphqlClient({
      endpoint: "http://localhost:3000/graphql",
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    await expect(client.request({ query: "{ x }" })).rejects.toSatisfy(
      (err: unknown) => isDagsterError(err) && err.kind === "graphql",
    );
  });

  it("honors abort signal", async () => {
    const ac = new AbortController();
    ac.abort();
    const fetchImpl = vi.fn();
    const client = createGraphqlClient({
      endpoint: "http://localhost:3000/graphql",
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    await expect(
      client.request({ query: "{ version }", signal: ac.signal }),
    ).rejects.toSatisfy((err: unknown) => isDagsterError(err) && err.kind === "aborted");
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("applies env headersResolver to fetch init without leaking secret in endpoint", async () => {
    process.env.PI_DAGSTER_TEST_TOKEN = "super-secret-token-xyz";
    let seenAuth: string | null = null;
    const fetchImpl = vi.fn(async (_url: string, init?: RequestInit) => {
      const headers = init?.headers as Record<string, string>;
      seenAuth = headers?.Authorization ?? null;
      return new Response(JSON.stringify({ data: { version: "ok" } }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    });

    const client = createGraphqlClient({
      endpoint: "http://localhost:3000/graphql",
      headersResolver: { type: "env", value: "PI_DAGSTER_TEST_TOKEN" },
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    const data = await client.request<{ version: string }>({ query: "{ version }" });
    expect(data.version).toBe("ok");
    expect(seenAuth).toBe("Bearer super-secret-token-xyz");
    // Client public surface must not expose secret
    expect(client.endpoint).toBe("http://localhost:3000/graphql");
    expect(JSON.stringify(data)).not.toContain("super-secret-token-xyz");
  });
});

describe("isMutationDocument", () => {
  it("detects mutation documents", () => {
    expect(isMutationDocument("mutation { launchRun }")).toBe(true);
    expect(isMutationDocument("  mutation Foo { x }")).toBe(true);
    expect(isMutationDocument("query { version }")).toBe(false);
    expect(isMutationDocument("{ version }")).toBe(false);
  });
});
