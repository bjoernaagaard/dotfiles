import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import type { DagsterRuntime } from "../runtime.ts";
import { rankCatalog, SEARCHABLE_TOOL_NAMES } from "./catalog.ts";
import { computeAdditiveActiveTools } from "../state/session.ts";

export type SearchToolsDetails = {
  matches: string[];
  added: string[];
};

/**
 * Pure ranking + additive activation used by dagster_search_tools.
 * Extracted so unit tests do not need a full Pi process.
 */
export function runSearchTools(input: {
  query: string;
  limit?: number;
  getActiveTools: () => string[];
  setActiveTools: (names: string[]) => void;
  markToolsLoaded: (names: string[]) => void;
}): SearchToolsDetails {
  const limit = Math.min(Math.max(input.limit ?? 5, 1), 12);
  const ranked = rankCatalog(input.query, { limit, onlySearchable: true });
  // Only activate tools that are in our searchable set (defense in depth).
  const matches = ranked
    .map((t) => t.name)
    .filter((n) => SEARCHABLE_TOOL_NAMES.has(n));

  const active = input.getActiveTools();
  // ADDITIVE ONLY — never remove currently active tools inside the loader.
  const { next, added } = computeAdditiveActiveTools(active, matches);
  input.setActiveTools(next);
  input.markToolsLoaded(added);
  return { matches, added };
}

export function applySearchToolsOnPi(
  pi: ExtensionAPI,
  runtime: DagsterRuntime,
  query: string,
  limit?: number,
): SearchToolsDetails {
  return runSearchTools({
    query,
    limit,
    getActiveTools: () => pi.getActiveTools(),
    setActiveTools: (names) => pi.setActiveTools(names),
    markToolsLoaded: (names) => runtime.markToolsLoaded(names),
  });
}
