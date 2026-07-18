/**
 * Pure mappers: assetNode GraphQL → summary for tools.
 */
import { mapUnionError, type UnionErrorResult } from "./errors.ts";

export type AssetKeyPath = string[];

export type AssetSummary = {
  assetKey: string;
  path: string[];
  description?: string | null;
  groupName?: string;
  jobNames?: string[];
  kinds?: string[];
  owners?: string[];
  isPartitioned?: boolean;
  isMaterializable?: boolean;
  isObservable?: boolean;
  computeKind?: string | null;
  dependencyKeys?: string[];
  dependedByKeys?: string[];
  repositoryName?: string;
  locationName?: string;
  recentMaterializations?: Array<{
    runId: string;
    timestamp: string;
    partition?: string | null;
    stepKey?: string | null;
  }>;
  freshnessStatus?: string;
};

export type AssetInspectResult =
  | { ok: true; asset: AssetSummary }
  | { ok: false; error: UnionErrorResult };

export function parseAssetKeyInput(assetKey: string | string[]): AssetKeyPath {
  if (Array.isArray(assetKey)) {
    return assetKey.map(String).filter(Boolean);
  }
  const raw = assetKey.trim();
  if (!raw) return [];

  // JSON array form: ["a","b"]
  if (raw.startsWith("[")) {
    try {
      const parsed = JSON.parse(raw) as unknown;
      if (Array.isArray(parsed)) return parsed.map(String);
    } catch {
      // fall through
    }
  }

  // path/with/slashes
  return raw.split("/").filter(Boolean);
}

export function formatAssetKey(path: AssetKeyPath): string {
  return path.join("/");
}

export function mapAssetNode(node: Record<string, unknown>): AssetSummary {
  const keyObj = node.assetKey as { path?: string[] } | undefined;
  const path = keyObj?.path ?? [];
  const ownersRaw = (node.owners as Array<Record<string, unknown>> | undefined) ?? [];
  const owners = ownersRaw.map((o) => {
    if (o.__typename === "UserAssetOwner" || typeof o.email === "string") {
      return String(o.email);
    }
    if (o.__typename === "TeamAssetOwner" || typeof o.team === "string") {
      return `team:${String(o.team)}`;
    }
    return "unknown";
  });

  const depKeys = ((node.dependencyKeys as Array<{ path: string[] }> | undefined) ?? []).map(
    (k) => formatAssetKey(k.path),
  );
  const depByKeys = ((node.dependedByKeys as Array<{ path: string[] }> | undefined) ?? []).map(
    (k) => formatAssetKey(k.path),
  );

  const mats = (
    (node.assetMaterializations as Array<Record<string, unknown>> | undefined) ?? []
  ).map((m) => ({
    runId: String(m.runId ?? ""),
    timestamp: String(m.timestamp ?? ""),
    partition: (m.partition as string | null | undefined) ?? null,
    stepKey: (m.stepKey as string | null | undefined) ?? null,
  }));

  const repo = node.repository as
    | { name?: string; location?: { name?: string } }
    | undefined;

  const freshness = node.freshnessStatusInfo as { freshnessStatus?: string } | undefined;

  return {
    assetKey: formatAssetKey(path),
    path,
    description: (node.description as string | null | undefined) ?? null,
    groupName: node.groupName as string | undefined,
    jobNames: (node.jobNames as string[] | undefined) ?? [],
    kinds: (node.kinds as string[] | undefined) ?? [],
    owners,
    isPartitioned: Boolean(node.isPartitioned),
    isMaterializable: node.isMaterializable as boolean | undefined,
    isObservable: node.isObservable as boolean | undefined,
    computeKind: (node.computeKind as string | null | undefined) ?? null,
    dependencyKeys: depKeys,
    dependedByKeys: depByKeys,
    repositoryName: repo?.name,
    locationName: repo?.location?.name,
    recentMaterializations: mats,
    freshnessStatus: freshness?.freshnessStatus,
  };
}

export function mapAssetNodeOrError(payload: {
  assetNodeOrError?: Record<string, unknown>;
}): AssetInspectResult {
  const node = payload.assetNodeOrError;
  if (!node) {
    return {
      ok: false,
      error: { kind: "Other", typename: "Missing", message: "No assetNodeOrError in response" },
    };
  }
  if (node.__typename === "AssetNode" || (node.assetKey && !String(node.__typename ?? "").includes("Error"))) {
    // Prefer explicit typename; some fixtures may omit it for AssetNode.
    if (node.__typename && node.__typename !== "AssetNode") {
      return { ok: false, error: mapUnionError(node as { __typename?: string; message?: string }) };
    }
    return { ok: true, asset: mapAssetNode(node) };
  }
  return { ok: false, error: mapUnionError(node as { __typename?: string; message?: string }) };
}

export function formatAssetSummary(asset: AssetSummary): string {
  const lines = [
    `asset: ${asset.assetKey}`,
    asset.groupName ? `group: ${asset.groupName}` : null,
    asset.description ? `description: ${asset.description}` : null,
    asset.jobNames?.length ? `jobs: ${asset.jobNames.join(", ")}` : null,
    asset.kinds?.length ? `kinds: ${asset.kinds.join(", ")}` : null,
    asset.owners?.length ? `owners: ${asset.owners.join(", ")}` : null,
    `partitioned: ${asset.isPartitioned ? "yes" : "no"}`,
    asset.repositoryName
      ? `repository: ${asset.locationName ?? "?"}/${asset.repositoryName}`
      : null,
    asset.dependencyKeys?.length
      ? `deps (${asset.dependencyKeys.length}): ${asset.dependencyKeys.slice(0, 12).join(", ")}${asset.dependencyKeys.length > 12 ? "…" : ""}`
      : null,
    asset.dependedByKeys?.length
      ? `dependedBy (${asset.dependedByKeys.length}): ${asset.dependedByKeys.slice(0, 12).join(", ")}`
      : null,
    asset.freshnessStatus ? `freshness: ${asset.freshnessStatus}` : null,
  ].filter(Boolean) as string[];

  if (asset.recentMaterializations?.length) {
    lines.push("recent materializations:");
    for (const m of asset.recentMaterializations) {
      lines.push(
        `  - run=${m.runId} ts=${m.timestamp}${m.partition ? ` partition=${m.partition}` : ""}`,
      );
    }
  }
  return lines.join("\n");
}
