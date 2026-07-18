/**
 * Pure ranking/merge of multi-entity search hits.
 */

export type SearchEntityKind = "asset" | "job" | "run" | "schedule" | "sensor";

export type SearchHit = {
  kind: SearchEntityKind;
  id: string;
  label: string;
  extra?: Record<string, unknown>;
  /** Internal score before ranking. */
  score?: number;
};

export type SearchableAsset = {
  path: string[];
  groupName?: string;
  description?: string | null;
  jobNames?: string[];
};

export type SearchableJob = {
  name: string;
  description?: string | null;
  repositoryName?: string;
  locationName?: string;
};

export type SearchableRun = {
  runId: string;
  status?: string;
  jobName?: string;
};

export type SearchableSchedule = {
  name: string;
  description?: string | null;
  pipelineName?: string;
  cronSchedule?: string;
  repositoryName?: string;
  locationName?: string;
};

export type SearchableSensor = {
  name: string;
  description?: string | null;
  repositoryName?: string;
  locationName?: string;
};

export function tokenizeQuery(query: string): string[] {
  return query
    .toLowerCase()
    .split(/[^a-z0-9_./:-]+/)
    .filter(Boolean);
}

function scoreText(haystack: string, terms: string[]): number {
  const h = haystack.toLowerCase();
  let score = 0;
  for (const term of terms) {
    if (!term) continue;
    if (h === term) score += 5;
    else if (h.startsWith(term)) score += 3;
    else if (h.includes(term)) score += 1;
  }
  return score;
}

export function rankSearchHits(
  input: {
    query: string;
    assets?: SearchableAsset[];
    jobs?: SearchableJob[];
    runs?: SearchableRun[];
    schedules?: SearchableSchedule[];
    sensors?: SearchableSensor[];
    kinds?: SearchEntityKind[];
    limit?: number;
  },
): SearchHit[] {
  const terms = tokenizeQuery(input.query);
  const limit = Math.min(Math.max(input.limit ?? 20, 1), 50);
  const kindFilter = input.kinds?.length
    ? new Set(input.kinds)
    : null;

  const hits: SearchHit[] = [];

  if (!kindFilter || kindFilter.has("asset")) {
    for (const a of input.assets ?? []) {
      const id = a.path.join("/");
      const hay = [id, a.groupName ?? "", a.description ?? "", ...(a.jobNames ?? [])].join(" ");
      const score = terms.length === 0 ? 1 : scoreText(hay, terms);
      if (score > 0) {
        hits.push({
          kind: "asset",
          id,
          label: id,
          extra: { groupName: a.groupName, description: a.description },
          score,
        });
      }
    }
  }

  if (!kindFilter || kindFilter.has("job")) {
    for (const j of input.jobs ?? []) {
      const hay = [j.name, j.description ?? "", j.repositoryName ?? "", j.locationName ?? ""].join(
        " ",
      );
      const score = terms.length === 0 ? 1 : scoreText(hay, terms);
      if (score > 0) {
        hits.push({
          kind: "job",
          id: j.name,
          label: j.name,
          extra: {
            description: j.description,
            repositoryName: j.repositoryName,
            locationName: j.locationName,
          },
          score,
        });
      }
    }
  }

  if (!kindFilter || kindFilter.has("run")) {
    for (const r of input.runs ?? []) {
      const hay = [r.runId, r.jobName ?? "", r.status ?? ""].join(" ");
      const score = terms.length === 0 ? 1 : scoreText(hay, terms);
      if (score > 0) {
        hits.push({
          kind: "run",
          id: r.runId,
          label: `${r.runId}${r.jobName ? ` (${r.jobName})` : ""}`,
          extra: { status: r.status, jobName: r.jobName },
          score,
        });
      }
    }
  }

  if (!kindFilter || kindFilter.has("schedule")) {
    for (const s of input.schedules ?? []) {
      const hay = [s.name, s.description ?? "", s.pipelineName ?? "", s.cronSchedule ?? ""].join(
        " ",
      );
      const score = terms.length === 0 ? 1 : scoreText(hay, terms);
      if (score > 0) {
        hits.push({
          kind: "schedule",
          id: s.name,
          label: s.name,
          extra: {
            cronSchedule: s.cronSchedule,
            pipelineName: s.pipelineName,
            repositoryName: s.repositoryName,
          },
          score,
        });
      }
    }
  }

  if (!kindFilter || kindFilter.has("sensor")) {
    for (const s of input.sensors ?? []) {
      const hay = [s.name, s.description ?? ""].join(" ");
      const score = terms.length === 0 ? 1 : scoreText(hay, terms);
      if (score > 0) {
        hits.push({
          kind: "sensor",
          id: s.name,
          label: s.name,
          extra: {
            description: s.description,
            repositoryName: s.repositoryName,
            locationName: s.locationName,
          },
          score,
        });
      }
    }
  }

  return hits
    .sort(
      (a, b) =>
        (b.score ?? 0) - (a.score ?? 0) ||
        a.kind.localeCompare(b.kind) ||
        a.id.localeCompare(b.id),
    )
    .slice(0, limit)
    .map(({ score: _s, ...rest }) => rest);
}

export function formatSearchHits(hits: SearchHit[]): string {
  if (hits.length === 0) return "No matches.";
  return hits
    .map((h, i) => {
      const extra = h.extra
        ? Object.entries(h.extra)
            .filter(([, v]) => v != null && v !== "")
            .slice(0, 3)
            .map(([k, v]) => `${k}=${String(v)}`)
            .join(" ")
        : "";
      return `${i + 1}. [${h.kind}] ${h.label}${extra ? ` — ${extra}` : ""}`;
    })
    .join("\n");
}
