import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import type { DagsterRuntime } from "../runtime.ts";
import {
  SEARCHABLE_TOOL_NAMES,
  alwaysOnNames,
} from "./catalog.ts";
import { createSearchToolsTool } from "./always-on/search-tools.ts";
import { createTargetStatusTool } from "./always-on/target-status.ts";
import { createSearchTool } from "./always-on/search.ts";
import { createGetContextTool } from "./always-on/get-context.ts";
import { createCapabilitiesTool } from "./always-on/capabilities.ts";
import { createGraphqlQueryTool } from "./always-on/graphql-query.ts";
import { createLazyTools } from "./lazy/stubs.ts";
import {
  computeSessionStartActiveTools,
  extractPreviouslyLoadedFromBranch,
  type BranchEntry,
} from "../state/session.ts";

/**
 * Register every Dagster tool (always-on + lazy). Active set is controlled at session_start.
 */
export function registerAllTools(pi: ExtensionAPI, runtime: DagsterRuntime): void {
  // Always-on
  pi.registerTool(createSearchToolsTool(pi, runtime));
  pi.registerTool(createTargetStatusTool(runtime));
  pi.registerTool(createSearchTool(runtime));
  pi.registerTool(createGetContextTool(runtime));
  pi.registerTool(createCapabilitiesTool(runtime));
  pi.registerTool(createGraphqlQueryTool(runtime));

  // Lazy searchable tools (registered, initially inactive)
  for (const tool of createLazyTools(runtime)) {
    pi.registerTool(tool);
  }
}

/**
 * Apply session_start active-set rules:
 * preserve foreign tools, ensure always-on, restore previously loaded searchable tools.
 */
export function applySessionStartActiveTools(
  pi: Pick<ExtensionAPI, "getActiveTools" | "setActiveTools">,
  runtime: DagsterRuntime,
  sessionManager?: { getBranch(): BranchEntry[] },
): string[] {
  if (sessionManager) {
    runtime.reconstructFromBranch(sessionManager);
  }

  const previouslyLoaded =
    runtime.getLoadedLazyTools().length > 0
      ? runtime.getLoadedLazyTools()
      : sessionManager
        ? extractPreviouslyLoadedFromBranch(sessionManager.getBranch())
        : [];

  const next = computeSessionStartActiveTools({
    current: pi.getActiveTools(),
    alwaysOn: alwaysOnNames(),
    searchable: SEARCHABLE_TOOL_NAMES,
    previouslyLoaded,
  });

  pi.setActiveTools(next);
  return next;
}

/** Optional non-additive reset used by /dagster-tools reset (outside the loader). */
export function resetToAlwaysOn(
  pi: Pick<ExtensionAPI, "getActiveTools" | "setActiveTools">,
  runtime?: Pick<DagsterRuntime, "clearLoadedLazyTools">,
): string[] {
  // Allowed outside the loader: drop searchable lazy tools, keep foreign + always-on.
  const next = computeSessionStartActiveTools({
    current: pi.getActiveTools(),
    alwaysOn: alwaysOnNames(),
    searchable: SEARCHABLE_TOOL_NAMES,
    previouslyLoaded: [],
  });
  pi.setActiveTools(next);
  runtime?.clearLoadedLazyTools();
  return next;
}
