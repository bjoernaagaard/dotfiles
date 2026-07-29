/**
 * Pure mappers: pipeline/job GraphQL → summary for tools.
 */
import { mapUnionError, type UnionErrorResult } from "./errors.ts";

export type JobSummary = {
  name: string;
  description?: string | null;
  isJob?: boolean;
  isAssetJob?: boolean;
  graphName?: string;
  nodeNames?: string[];
  solidsCount?: number;
  solidNames?: string[];
  modes?: Array<{ name: string; description?: string | null }>;
  presets?: Array<{ name: string; mode?: string }>;
  repositoryName?: string;
  locationName?: string;
  tags?: Array<{ key: string; value: string }>;
};

export type JobInspectResult =
  | { ok: true; job: JobSummary }
  | { ok: false; error: UnionErrorResult };

export type JobSelector = {
  pipelineName: string;
  repositoryName: string;
  repositoryLocationName: string;
};

export function mapPipeline(node: Record<string, unknown>): JobSummary {
  const solids = (node.solids as Array<{ name: string }> | undefined) ?? [];
  const modes = ((node.modes as Array<{ name: string; description?: string | null }> | undefined) ?? []).map(
    (m) => ({ name: m.name, description: m.description ?? null }),
  );
  const presets = (
    (node.presets as Array<{ name: string; mode?: string }> | undefined) ?? []
  ).map((p) => ({ name: p.name, mode: p.mode }));
  const repo = node.repository as
    | { name?: string; location?: { name?: string } }
    | undefined;

  return {
    name: String(node.name ?? ""),
    description: (node.description as string | null | undefined) ?? null,
    isJob: Boolean(node.isJob),
    isAssetJob: Boolean(node.isAssetJob),
    graphName: node.graphName as string | undefined,
    nodeNames: (node.nodeNames as string[] | undefined) ?? [],
    solidsCount: solids.length,
    solidNames: solids.map((s) => s.name).slice(0, 50),
    modes,
    presets,
    repositoryName: repo?.name,
    locationName: repo?.location?.name,
    tags: ((node.tags as Array<{ key: string; value: string }> | undefined) ?? []).map((t) => ({
      key: t.key,
      value: t.value,
    })),
  };
}

export function mapPipelineOrError(payload: {
  pipelineOrError?: Record<string, unknown>;
}): JobInspectResult {
  const node = payload.pipelineOrError;
  if (!node) {
    return {
      ok: false,
      error: { kind: "Other", typename: "Missing", message: "No pipelineOrError in response" },
    };
  }
  if (node.__typename === "Pipeline" || (node.name && !String(node.__typename ?? "").includes("Error"))) {
    if (node.__typename && node.__typename !== "Pipeline") {
      return { ok: false, error: mapUnionError(node as { __typename?: string; message?: string }) };
    }
    return { ok: true, job: mapPipeline(node) };
  }
  return { ok: false, error: mapUnionError(node as { __typename?: string; message?: string; stack?: string[] }) };
}

export function formatJobSummary(job: JobSummary): string {
  const lines = [
    `job: ${job.name}`,
    job.description ? `description: ${job.description}` : null,
    `isJob: ${job.isJob ? "yes" : "no"}${job.isAssetJob ? " (asset job)" : ""}`,
    job.graphName ? `graph: ${job.graphName}` : null,
    job.repositoryName
      ? `repository: ${job.locationName ?? "?"}/${job.repositoryName}`
      : null,
    job.modes?.length ? `modes: ${job.modes.map((m) => m.name).join(", ")}` : null,
    job.presets?.length ? `presets: ${job.presets.map((p) => p.name).join(", ")}` : null,
    job.solidsCount != null
      ? `ops/solids: ${job.solidsCount}${job.solidNames?.length ? ` [${job.solidNames.slice(0, 20).join(", ")}${job.solidsCount! > 20 ? "…" : ""}]` : ""}`
      : null,
  ].filter(Boolean) as string[];
  return lines.join("\n");
}

/** Find a job selector by name across repository listing. */
export function findJobSelector(
  repos: Array<{
    name: string;
    location?: { name?: string };
    jobs?: Array<{ name: string }>;
    pipelines?: Array<{ name: string; isJob?: boolean }>;
  }>,
  jobName: string,
  preferred?: { repositoryName?: string; locationName?: string },
): JobSelector | null {
  const matches: JobSelector[] = [];
  for (const repo of repos) {
    const locationName = repo.location?.name ?? "";
    if (preferred?.repositoryName && repo.name !== preferred.repositoryName) continue;
    if (preferred?.locationName && locationName !== preferred.locationName) continue;

    const names = new Set<string>();
    for (const j of repo.jobs ?? []) names.add(j.name);
    for (const p of repo.pipelines ?? []) names.add(p.name);
    if (names.has(jobName)) {
      matches.push({
        pipelineName: jobName,
        repositoryName: repo.name,
        repositoryLocationName: locationName,
      });
    }
  }

  if (matches.length === 0) {
    // Retry without preferred filters if none matched
    if (preferred?.repositoryName || preferred?.locationName) {
      return findJobSelector(repos, jobName, undefined);
    }
    return null;
  }
  return matches[0] ?? null;
}
