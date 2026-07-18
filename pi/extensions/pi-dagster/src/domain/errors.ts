/**
 * Normalize GraphQL / HTTP transport failures for agent-safe messages.
 * Never include secrets (headers, tokens) in messages.
 */

export type DagsterClientErrorKind =
  | "transport"
  | "http"
  | "graphql"
  | "unauthorized"
  | "aborted"
  | "not_connected"
  | "config";

export type DagsterClientError = {
  kind: DagsterClientErrorKind;
  message: string;
  status?: number;
};

export class DagsterError extends Error {
  readonly kind: DagsterClientErrorKind;
  readonly status?: number;

  constructor(err: DagsterClientError) {
    super(err.message);
    this.name = "DagsterError";
    this.kind = err.kind;
    this.status = err.status;
  }

  toJSON(): DagsterClientError {
    return {
      kind: this.kind,
      message: this.message,
      status: this.status,
    };
  }
}

export function isDagsterError(err: unknown): err is DagsterError {
  return err instanceof DagsterError;
}

export function throwTransport(message: string, status?: number): never {
  throw new DagsterError({
    kind: status === 401 || status === 403 ? "unauthorized" : status ? "http" : "transport",
    message,
    status,
  });
}

export function throwGraphql(messages: string[]): never {
  const text = messages.filter(Boolean).join("; ") || "GraphQL request failed";
  throw new DagsterError({ kind: "graphql", message: text });
}

export function throwAborted(): never {
  throw new DagsterError({ kind: "aborted", message: "Request aborted" });
}

export function throwNotConnected(hint?: string): never {
  throw new DagsterError({
    kind: "not_connected",
    message:
      hint ??
      "No Dagster GraphQL client connected. Use /dagster-connect or set an active profile with graphqlHttp.",
  });
}

/** GraphQL union error shapes returned inside `data` (not transport errors). */
export type UnionErrorKind = "PythonError" | "NotFound" | "Other";

export type UnionErrorResult = {
  kind: UnionErrorKind;
  typename: string;
  message: string;
  stack?: string[];
};

export function mapUnionError(node: {
  __typename?: string;
  message?: string;
  stack?: string[];
  runId?: string;
  repositoryName?: string;
  repositoryLocationName?: string;
}): UnionErrorResult {
  const typename = node.__typename ?? "Unknown";
  if (typename === "PythonError") {
    return {
      kind: "PythonError",
      typename,
      message: node.message ?? "PythonError",
      stack: node.stack,
    };
  }
  if (typename.endsWith("NotFoundError") || typename.includes("NotFound")) {
    return {
      kind: "NotFound",
      typename,
      message: node.message ?? `${typename}`,
    };
  }
  return {
    kind: "Other",
    typename,
    message: node.message ?? typename,
  };
}
