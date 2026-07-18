/**
 * Shared cross-entity search core used by dagster_search tool and /dagster-search.
 * GraphQL documents live in clients/documents; ranking in domain/search.
 */
import type { GraphqlClient } from "../clients/graphql.ts";
import {
  SEARCH_ASSETS_QUERY,
  SEARCH_REPOS_QUERY,
  SEARCH_RUNS_QUERY,
} from "../clients/documents/search.gql.ts";
import {
  formatSearchHits,
  rankSearchHits,
  type SearchEntityKind,
  type SearchHit,
  type SearchableAsset,
  type SearchableJob,
  type SearchableRun,
  type SearchableSchedule,
  type SearchableSensor,
} from "./search.ts";

export type CrossSearchInput = {
  query: string;
  kinds?: SearchEntityKind[];
  limit?: number;
  signal?: AbortSignal;
};

export type CrossSearchResult = {
  matches: SearchHit[];
  notes: string[];
  text: string;
};

function throwIfSearchAborted(error: unknown, signal?: AbortSignal): void {
  if (signal?.aborted || (error instanceof Error && error.name === "AbortError")) {
    const aborted = new Error("Dagster search aborted");
    aborted.name = "AbortError";
    throw aborted;
  }
}

export async function runCrossEntitySearch(
  client: GraphqlClient,
  params: CrossSearchInput,
): Promise<CrossSearchResult> {
  const kinds = params.kinds;
  const want = (k: SearchEntityKind) => !kinds || kinds.includes(k);
  const signal = params.signal;

  const assets: SearchableAsset[] = [];
  const jobs: SearchableJob[] = [];
  const runs: SearchableRun[] = [];
  const schedules: SearchableSchedule[] = [];
  const sensors: SearchableSensor[] = [];
  const notes: string[] = [];

  if (want("asset")) {
    try {
      const data = await client.request<{
        assetNodes: Array<{
          assetKey: { path: string[] };
          groupName?: string;
          description?: string | null;
          jobNames?: string[];
        }>;
      }>({ query: SEARCH_ASSETS_QUERY, signal, operationName: "DagsterSearchAssets" });
      for (const n of data.assetNodes ?? []) {
        assets.push({
          path: n.assetKey?.path ?? [],
          groupName: n.groupName,
          description: n.description,
          jobNames: n.jobNames,
        });
      }
    } catch (err) {
      throwIfSearchAborted(err, signal);
      notes.push(`assets: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  if (want("job") || want("schedule") || want("sensor")) {
    try {
      const data = await client.request<{
        repositoriesOrError: {
          __typename: string;
          message?: string;
          nodes?: Array<{
            name: string;
            location?: { name?: string };
            jobs?: Array<{ name: string; description?: string | null }>;
            pipelines?: Array<{
              name: string;
              description?: string | null;
              isJob?: boolean;
            }>;
            schedules?: Array<{
              name: string;
              description?: string | null;
              pipelineName?: string;
              cronSchedule?: string;
            }>;
            sensors?: Array<{ name: string; description?: string | null }>;
          }>;
        };
      }>({ query: SEARCH_REPOS_QUERY, signal, operationName: "DagsterSearchRepos" });

      const node = data.repositoriesOrError;
      if (node.__typename === "RepositoryConnection") {
        for (const repo of node.nodes ?? []) {
          const locationName = repo.location?.name;
          if (want("job")) {
            const seen = new Set<string>();
            for (const j of repo.jobs ?? []) {
              seen.add(j.name);
              jobs.push({
                name: j.name,
                description: j.description,
                repositoryName: repo.name,
                locationName,
              });
            }
            for (const p of repo.pipelines ?? []) {
              if (seen.has(p.name)) continue;
              jobs.push({
                name: p.name,
                description: p.description,
                repositoryName: repo.name,
                locationName,
              });
            }
          }
          if (want("schedule")) {
            for (const s of repo.schedules ?? []) {
              schedules.push({
                name: s.name,
                description: s.description,
                pipelineName: s.pipelineName,
                cronSchedule: s.cronSchedule,
                repositoryName: repo.name,
                locationName,
              });
            }
          }
          if (want("sensor")) {
            for (const s of repo.sensors ?? []) {
              sensors.push({
                name: s.name,
                description: s.description,
                repositoryName: repo.name,
                locationName,
              });
            }
          }
        }
      } else if (node.message) {
        notes.push(`repositories: ${node.message}`);
      }
    } catch (err) {
      throwIfSearchAborted(err, signal);
      notes.push(`repositories: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  if (want("run")) {
    try {
      const data = await client.request<{
        runsOrError: {
          __typename: string;
          message?: string;
          results?: Array<{
            runId: string;
            status?: string;
            jobName?: string;
          }>;
        };
      }>({
        query: SEARCH_RUNS_QUERY,
        variables: { limit: 25 },
        signal,
        operationName: "DagsterSearchRuns",
      });
      const node = data.runsOrError;
      if (node.__typename === "Runs") {
        for (const r of node.results ?? []) {
          runs.push({
            runId: r.runId,
            status: r.status,
            jobName: r.jobName,
          });
        }
      } else if (node.message) {
        notes.push(`runs: ${node.message}`);
      }
    } catch (err) {
      throwIfSearchAborted(err, signal);
      notes.push(`runs: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  const matches = rankSearchHits({
    query: params.query,
    assets,
    jobs,
    runs,
    schedules,
    sensors,
    kinds,
    limit: params.limit,
  });

  let text = formatSearchHits(matches);
  if (notes.length) {
    text += `\n\nNotes:\n${notes.map((n) => `- ${n}`).join("\n")}`;
  }

  return { matches, notes, text };
}

/** Safe editor reference for a search hit (no secrets). */
export function searchHitEditorToken(hit: SearchHit): string {
  if (hit.kind === "run") return `#${hit.id}`;
  if (hit.kind === "asset") return `@${hit.id}`;
  if (hit.kind === "job") return `@job:${hit.id}`;
  return `@${hit.kind}:${hit.id}`;
}
