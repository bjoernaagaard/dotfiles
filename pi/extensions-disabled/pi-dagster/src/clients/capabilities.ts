/**
 * Capabilities probe + short TTL in-memory cache (per endpoint).
 */
import type { GraphqlClient } from "./graphql.ts";
import { CAPABILITIES_QUERY, WORKSPACE_HEALTH_QUERY } from "./documents/capabilities.gql.ts";
import { mapUnionError } from "../domain/errors.ts";

export const CAPABILITIES_TTL_MS = 30_000;

export type PermissionSummary = {
  permission: string;
  value: boolean;
  disabledReason?: string | null;
};

export type LocationStatus = {
  name: string;
  loadStatus: string;
  error?: string;
  repositories?: string[];
};

export type CapabilitiesSnapshot = {
  endpoint: string;
  version: string;
  permissions: PermissionSummary[];
  canBulkTerminate: boolean;
  locations: LocationStatus[];
  locationErrorCount: number;
  fetchedAt: number;
  workspaceId?: string;
};

type CapabilitiesQueryData = {
  version: string;
  permissions: Array<{
    permission: string;
    value: boolean;
    disabledReason?: string | null;
  }>;
  canBulkTerminate: boolean;
  locationStatusesOrError: {
    __typename: string;
    entries?: Array<{ name: string; loadStatus: string }>;
    message?: string;
    stack?: string[];
  };
};

type WorkspaceHealthData = {
  workspaceOrError: {
    __typename: string;
    id?: string;
    message?: string;
    locationEntries?: Array<{
      name: string;
      loadStatus: string;
      locationOrLoadError?: {
        __typename: string;
        name?: string;
        message?: string;
        repositories?: Array<{ name: string }>;
      };
    }>;
  };
};

export type CapabilitiesCache = {
  byEndpoint: Map<string, CapabilitiesSnapshot>;
};

export function createCapabilitiesCache(): CapabilitiesCache {
  return { byEndpoint: new Map() };
}

export function clearCapabilitiesCache(cache: CapabilitiesCache): void {
  cache.byEndpoint.clear();
}

/**
 * Fetch capabilities (version/permissions/locations). Cache TTL ~30s per endpoint.
 * `force` bypasses cache. `now` injectable for tests.
 */
export async function fetchCapabilities(
  client: GraphqlClient,
  options?: {
    force?: boolean;
    cache?: CapabilitiesCache;
    signal?: AbortSignal;
    now?: () => number;
    includeWorkspace?: boolean;
  },
): Promise<CapabilitiesSnapshot> {
  const cache = options?.cache;
  const now = options?.now?.() ?? Date.now();
  const endpoint = client.endpoint;

  if (!options?.force && cache) {
    const hit = cache.byEndpoint.get(endpoint);
    if (hit && now - hit.fetchedAt < CAPABILITIES_TTL_MS) {
      return hit;
    }
  }

  const data = await client.request<CapabilitiesQueryData>({
    query: CAPABILITIES_QUERY,
    signal: options?.signal,
    operationName: "DagsterCapabilities",
  });

  const locations = parseLocationStatuses(data.locationStatusesOrError);
  let workspaceId: string | undefined;

  if (options?.includeWorkspace !== false) {
    try {
      const ws = await client.request<WorkspaceHealthData>({
        query: WORKSPACE_HEALTH_QUERY,
        signal: options?.signal,
        operationName: "WorkspaceHealth",
      });
      const node = ws.workspaceOrError;
      if (node.__typename === "Workspace") {
        workspaceId = node.id;
        mergeWorkspaceLocations(locations, node.locationEntries ?? []);
      }
    } catch {
      // Workspace health is optional enrichment; capabilities still useful.
    }
  }

  const locationErrorCount = locations.filter((l) => l.error).length;

  const snapshot: CapabilitiesSnapshot = {
    endpoint,
    version: data.version,
    permissions: (data.permissions ?? []).map((p) => ({
      permission: p.permission,
      value: p.value,
      disabledReason: p.disabledReason,
    })),
    canBulkTerminate: Boolean(data.canBulkTerminate),
    locations,
    locationErrorCount,
    fetchedAt: now,
    workspaceId,
  };

  if (cache) {
    cache.byEndpoint.set(endpoint, snapshot);
  }
  return snapshot;
}

function parseLocationStatuses(
  node: CapabilitiesQueryData["locationStatusesOrError"],
): LocationStatus[] {
  if (node.__typename === "WorkspaceLocationStatusEntries") {
    return (node.entries ?? []).map((e) => ({
      name: e.name,
      loadStatus: e.loadStatus,
    }));
  }
  if (node.__typename === "PythonError") {
    const err = mapUnionError(node);
    return [{ name: "(workspace)", loadStatus: "ERROR", error: err.message }];
  }
  return [];
}

function mergeWorkspaceLocations(
  locations: LocationStatus[],
  entries: NonNullable<WorkspaceHealthData["workspaceOrError"]["locationEntries"]>,
): void {
  const byName = new Map(locations.map((l) => [l.name, l]));
  for (const entry of entries) {
    const existing = byName.get(entry.name) ?? {
      name: entry.name,
      loadStatus: entry.loadStatus,
    };
    existing.loadStatus = entry.loadStatus ?? existing.loadStatus;
    const load = entry.locationOrLoadError;
    if (load?.__typename === "PythonError") {
      existing.error = load.message ?? "PythonError";
    } else if (load?.__typename === "RepositoryLocation") {
      existing.repositories = (load.repositories ?? []).map((r) => r.name);
      existing.error = undefined;
    }
    byName.set(entry.name, existing);
  }
  locations.length = 0;
  locations.push(...byName.values());
}

/** Pure parser for tests / fixtures. */
export function parseCapabilitiesFixture(
  data: CapabilitiesQueryData,
  endpoint = "http://localhost:3000/graphql",
  fetchedAt = Date.now(),
): CapabilitiesSnapshot {
  const locations = parseLocationStatuses(data.locationStatusesOrError);
  return {
    endpoint,
    version: data.version,
    permissions: (data.permissions ?? []).map((p) => ({
      permission: p.permission,
      value: p.value,
      disabledReason: p.disabledReason,
    })),
    canBulkTerminate: Boolean(data.canBulkTerminate),
    locations,
    locationErrorCount: locations.filter((l) => l.error).length,
    fetchedAt,
  };
}

export function capabilitiesCacheAgeMs(
  snapshot: CapabilitiesSnapshot | null | undefined,
  now = Date.now(),
): number | null {
  if (!snapshot) return null;
  return Math.max(0, now - snapshot.fetchedAt);
}
