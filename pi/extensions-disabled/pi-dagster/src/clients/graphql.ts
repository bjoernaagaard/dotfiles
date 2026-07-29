/**
 * HTTP GraphQL client for Dagster OSS webserver.
 * Secrets resolved into headers stay in memory only.
 */
import {
  DagsterError,
  throwAborted,
  throwGraphql,
  throwTransport,
} from "../domain/errors.ts";
import { resolveHeaders, type HeadersResolver } from "./headers.ts";

export type GraphqlRequestOptions = {
  query: string;
  variables?: Record<string, unknown>;
  signal?: AbortSignal;
  operationName?: string;
};

export type GraphqlResponse<T> = {
  data?: T;
  errors?: Array<{ message: string; path?: unknown; extensions?: unknown }>;
};

export type GraphqlClientConfig = {
  /** Absolute GraphQL HTTP URL (public; safe to surface). */
  endpoint: string;
  staticHeaders?: Record<string, string>;
  headersResolver?: HeadersResolver;
  /** Optional fetch implementation (tests inject mock). */
  fetchImpl?: typeof fetch;
};

export interface GraphqlClient {
  /** Public URL only — never include secrets. */
  readonly endpoint: string;
  request<T>(opts: GraphqlRequestOptions): Promise<T>;
}

/**
 * Resolve GraphQL HTTP endpoint from profile fields.
 * - If graphqlHttp is absolute including path, use as-is
 * - If only origin (no path or path "/"), append pathPrefix + /graphql (default /graphql)
 */
export function resolveGraphqlEndpoint(input: {
  graphqlHttp?: string;
  pathPrefix?: string;
  ephemeralUrl?: string | null;
}): string {
  const raw = (input.ephemeralUrl ?? input.graphqlHttp ?? "").trim();
  if (!raw) {
    throw new DagsterError({
      kind: "config",
      message: "No GraphQL HTTP URL configured (set profile.graphqlHttp or --dagster-graphql)",
    });
  }

  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new DagsterError({
      kind: "config",
      message: `Invalid GraphQL HTTP URL: ${raw}`,
    });
  }

  // Absolute path already set (not empty and not just "/") → use as-is
  if (url.pathname && url.pathname !== "/") {
    return url.toString().replace(/\/$/, "");
  }

  const prefix = (input.pathPrefix ?? "").replace(/\/$/, "");
  const path = `${prefix}/graphql` || "/graphql";
  url.pathname = path.startsWith("/") ? path : `/${path}`;
  return url.toString().replace(/\/$/, "");
}

export function createGraphqlClient(config: GraphqlClientConfig): GraphqlClient {
  const fetchImpl = config.fetchImpl ?? globalThis.fetch.bind(globalThis);
  const endpoint = config.endpoint;

  return {
    endpoint,
    async request<T>(opts: GraphqlRequestOptions): Promise<T> {
      if (opts.signal?.aborted) throwAborted();

      let headers: Record<string, string>;
      try {
        headers = await resolveHeaders({
          staticHeaders: config.staticHeaders,
          resolver: config.headersResolver,
          signal: opts.signal,
        });
      } catch (err) {
        if (opts.signal?.aborted) throwAborted();
        const msg = err instanceof Error ? err.message : String(err);
        throw new DagsterError({ kind: "config", message: msg });
      }

      const body = JSON.stringify({
        query: opts.query,
        variables: opts.variables ?? undefined,
        operationName: opts.operationName,
      });

      let response: Response;
      try {
        response = await fetchImpl(endpoint, {
          method: "POST",
          headers,
          body,
          signal: opts.signal,
        });
      } catch (err) {
        if (opts.signal?.aborted || (err instanceof Error && err.name === "AbortError")) {
          throwAborted();
        }
        const msg = err instanceof Error ? err.message : String(err);
        // Never echo headers or body (may contain secrets).
        throwTransport(`GraphQL transport error: ${msg}`);
      }

      if (response.status === 401 || response.status === 403) {
        throwTransport(
          `GraphQL HTTP ${response.status} unauthorized — check headersResolver / credentials`,
          response.status,
        );
      }

      if (!response.ok) {
        throwTransport(`GraphQL HTTP ${response.status}`, response.status);
      }

      let json: GraphqlResponse<T>;
      try {
        json = (await response.json()) as GraphqlResponse<T>;
      } catch {
        throwTransport("GraphQL response was not valid JSON", response.status);
      }

      if (json.errors && json.errors.length > 0) {
        // Transport-level GraphQL errors[] → throw (redacted messages only).
        const messages = json.errors.map((e) => sanitizeErrorMessage(e.message));
        throwGraphql(messages);
      }

      if (json.data === undefined || json.data === null) {
        throwGraphql(["GraphQL response contained no data"]);
      }

      return json.data;
    },
  };
}

/** Strip anything that looks like a bearer token from error messages. */
function sanitizeErrorMessage(message: string): string {
  return message
    .replace(/Bearer\s+[A-Za-z0-9._\-]+/gi, "Bearer [redacted]")
    .replace(/eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g, "[redacted-jwt]");
}
