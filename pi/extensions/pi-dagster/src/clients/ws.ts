/**
 * GraphQL over WebSocket client (graphql-ws).
 * Auth via connectionParams from header resolution — never log connectionParams.
 */
import type {
  Client as GraphqlWsClient,
  createClient as createGraphqlWsClient,
} from "graphql-ws";
import { DagsterError, throwAborted } from "../domain/errors.ts";
import { resolveHeaders, type HeadersResolver } from "./headers.ts";

type GraphqlWsCreateClient = typeof createGraphqlWsClient;

export type WsClientConfig = {
  url: string;
  staticHeaders?: Record<string, string>;
  headersResolver?: HeadersResolver;
  /** Injected for tests. */
  createClientImpl?: GraphqlWsCreateClient;
  /** Injected WebSocket impl for tests / Node. */
  webSocketImpl?: unknown;
};

export type SubscribeOpts<T> = {
  query: string;
  variables?: Record<string, unknown>;
  operationName?: string;
  signal?: AbortSignal;
  onNext: (data: T) => void;
  onError?: (err: Error) => void;
  onComplete?: () => void;
};

export interface WsClient {
  /** Public WS URL only. */
  readonly url: string;
  subscribe<T>(opts: SubscribeOpts<T>): Promise<{ stop: () => void }>;
  close(): void;
}

/**
 * Derive GraphQL WS URL from HTTP endpoint when graphqlWs unset.
 * http→ws, https→wss, keep path.
 */
export function resolveGraphqlWsUrl(input: {
  graphqlWs?: string;
  graphqlHttp?: string;
  pathPrefix?: string;
  ephemeralUrl?: string | null;
}): string {
  const explicit = input.graphqlWs?.trim();
  if (explicit) return explicit.replace(/\/$/, "");

  const raw = (input.ephemeralUrl ?? input.graphqlHttp ?? "").trim();
  if (!raw) {
    throw new DagsterError({
      kind: "config",
      message:
        "No GraphQL WS URL configured (set profile.graphqlWs or derive from graphqlHttp / --dagster-graphql)",
    });
  }

  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new DagsterError({
      kind: "config",
      message: `Invalid GraphQL URL for WS derivation: ${raw}`,
    });
  }

  if (url.protocol === "http:") url.protocol = "ws:";
  else if (url.protocol === "https:") url.protocol = "wss:";
  else if (url.protocol === "ws:" || url.protocol === "wss:") {
    // already ws
  } else {
    throw new DagsterError({
      kind: "config",
      message: `Cannot derive WS URL from protocol ${url.protocol}`,
    });
  }

  if (!url.pathname || url.pathname === "/") {
    const prefix = (input.pathPrefix ?? "").replace(/\/$/, "");
    const path = `${prefix}/graphql` || "/graphql";
    url.pathname = path.startsWith("/") ? path : `/${path}`;
  }

  return url.toString().replace(/\/$/, "");
}

/**
 * Build connectionParams from headers (Authorization etc.) without Content-Type.
 * Never log the result.
 */
export async function buildConnectionParams(input: {
  staticHeaders?: Record<string, string>;
  headersResolver?: HeadersResolver;
  signal?: AbortSignal;
}): Promise<Record<string, unknown> | undefined> {
  const headers = await resolveHeaders({
    staticHeaders: input.staticHeaders,
    resolver: input.headersResolver,
    signal: input.signal,
  });
  const params: Record<string, string> = {};
  for (const [k, v] of Object.entries(headers)) {
    if (k.toLowerCase() === "content-type") continue;
    params[k] = v;
  }
  return Object.keys(params).length > 0 ? params : undefined;
}

async function loadGraphqlWsCreateClient(): Promise<GraphqlWsCreateClient> {
  try {
    const module = await import("graphql-ws");
    return module.createClient;
  } catch {
    throw new DagsterError({
      kind: "config",
      message:
        "GraphQL subscriptions require the local `graphql-ws` dependency. " +
        "Run `npm install` in the pi-dagster extension directory; global npm installs are not used by Node ESM resolution.",
    });
  }
}

export function createWsClient(config: WsClientConfig): WsClient {
  let closed = false;
  let client: GraphqlWsClient | null = null;
  let connecting: Promise<GraphqlWsClient> | null = null;

  async function ensureUnderlying(signal?: AbortSignal): Promise<GraphqlWsClient> {
    if (closed) {
      throw new DagsterError({ kind: "config", message: "WS client is closed" });
    }
    if (signal?.aborted) throwAborted();
    if (client) return client;
    if (connecting) return connecting;

    connecting = (async () => {
      // Resolve auth once at connect time.
      let connectionParams: Record<string, unknown> | (() => Promise<Record<string, unknown> | undefined>) | undefined;
      try {
        const params = await buildConnectionParams({
          staticHeaders: config.staticHeaders,
          headersResolver: config.headersResolver,
          signal,
        });
        connectionParams = params;
      } catch (err) {
        if (signal?.aborted) throwAborted();
        const msg = err instanceof Error ? err.message : String(err);
        throw new DagsterError({ kind: "config", message: msg });
      }

      // Load the optional WS transport only on first subscription. Pi can boot
      // and all HTTP/read/local-author tools remain available without it.
      const create = config.createClientImpl ?? (await loadGraphqlWsCreateClient());
      const c = create({
        url: config.url,
        connectionParams,
        webSocketImpl: config.webSocketImpl as never,
        // Avoid aggressive reconnect storms in agent sessions.
        retryAttempts: 2,
        lazy: true,
      });
      client = c;
      return c;
    })();

    try {
      return await connecting;
    } finally {
      connecting = null;
    }
  }

  return {
    url: config.url,
    async subscribe<T>(opts: SubscribeOpts<T>): Promise<{ stop: () => void }> {
      if (opts.signal?.aborted) throwAborted();
      if (closed) {
        throw new DagsterError({ kind: "config", message: "WS client is closed" });
      }

      const c = await ensureUnderlying(opts.signal);
      let unsubscribed = false;
      let dispose: (() => void) | null = null;

      const stop = () => {
        if (unsubscribed) return;
        unsubscribed = true;
        try {
          dispose?.();
        } catch {
          // ignore
        }
        dispose = null;
      };

      if (opts.signal) {
        if (opts.signal.aborted) {
          stop();
          throwAborted();
        }
        opts.signal.addEventListener(
          "abort",
          () => {
            stop();
          },
          { once: true },
        );
      }

      dispose = c.subscribe(
        {
          query: opts.query,
          variables: opts.variables,
          operationName: opts.operationName,
        },
        {
          next: (result) => {
            if (unsubscribed) return;
            if (result.errors && result.errors.length > 0) {
              const msg = result.errors.map((e) => e.message).join("; ");
              opts.onError?.(new Error(msg));
              return;
            }
            if (result.data !== undefined && result.data !== null) {
              opts.onNext(result.data as T);
            }
          },
          error: (err) => {
            if (unsubscribed) return;
            const e = err instanceof Error ? err : new Error(String(err));
            opts.onError?.(e);
          },
          complete: () => {
            if (unsubscribed) return;
            opts.onComplete?.();
          },
        },
      );

      return { stop };
    },
    close(): void {
      if (closed) return;
      closed = true;
      const c = client;
      client = null;
      try {
        c?.dispose();
      } catch {
        // ignore
      }
    },
  };
}

/** Test helper: create a WsClient from a fake subscribe implementation. */
export function createFakeWsClient(opts: {
  url?: string;
  onSubscribe?: (args: {
    query: string;
    variables?: Record<string, unknown>;
  }) => {
    push: (data: unknown) => void;
    error: (err: Error) => void;
    complete: () => void;
    stop: () => void;
  };
}): WsClient & {
  /** Access last subscription controller */
  last?: ReturnType<NonNullable<typeof opts.onSubscribe>>;
} {
  const url = opts.url ?? "ws://example.test/graphql";
  let closed = false;
  const fake: WsClient & { last?: ReturnType<NonNullable<typeof opts.onSubscribe>> } = {
    url,
    async subscribe<T>(subOpts: SubscribeOpts<T>) {
      if (closed) throw new Error("WS closed");
      if (subOpts.signal?.aborted) throwAborted();
      const controller = opts.onSubscribe?.({
        query: subOpts.query,
        variables: subOpts.variables,
      }) ?? {
        push: () => {},
        error: () => {},
        complete: () => {},
        stop: () => {},
      };
      fake.last = controller;

      // Wire push to onNext
      const origPush = controller.push;
      controller.push = (data: unknown) => {
        subOpts.onNext(data as T);
        origPush(data);
      };
      const origError = controller.error;
      controller.error = (err: Error) => {
        subOpts.onError?.(err);
        origError(err);
      };
      const origComplete = controller.complete;
      controller.complete = () => {
        subOpts.onComplete?.();
        origComplete();
      };

      if (subOpts.signal) {
        subOpts.signal.addEventListener(
          "abort",
          () => {
            controller.stop();
          },
          { once: true },
        );
      }

      return {
        stop: () => {
          controller.stop();
        },
      };
    },
    close() {
      closed = true;
    },
  };
  return fake;
}
