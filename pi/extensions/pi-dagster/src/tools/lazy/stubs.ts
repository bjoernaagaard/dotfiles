import type { DagsterRuntime } from "../../runtime.ts";
import { LAZY_TOOL_NAMES } from "../catalog.ts";
import { createInspectAssetTool } from "./inspect-asset.ts";
import { createInspectRunTool } from "./inspect-run.ts";
import { createInspectJobTool } from "./inspect-job.ts";
import { createSchemaSearchTool } from "./schema-search.ts";
import { createDgCommandTool } from "./dg-command.ts";
import { createLaunchRunTool } from "./launch-run.ts";
import { createReexecuteRunTool } from "./reexecute-run.ts";
import { createTerminateRunTool } from "./terminate-run.ts";
import { createBackfillTool } from "./backfill.ts";
import { createScheduleControlTool } from "./schedule-control.ts";
import { createSensorControlTool } from "./sensor-control.ts";
import { createReloadLocationTool } from "./reload-location.ts";
import { createGraphqlMutationTool } from "./graphql-mutation.ts";
import { createGraphqlSubscribeTool } from "./graphql-subscribe.ts";
import { createWatchRunTool } from "./watch-run.ts";
import { createEvidencePackTool } from "./evidence-pack.ts";
import { createCompareRunTool } from "./compare-run.ts";

/**
 * Lazy tools MUST omit promptSnippet and promptGuidelines so activation
 * does not rebuild the system-prompt prefix (proposal §4.3).
 *
 * Phase 3: all listed lazy tools are real implementations (no stubs).
 */
export function createLazyTools(runtime: DagsterRuntime) {
  return [
    createInspectAssetTool(runtime),
    createInspectRunTool(runtime),
    createInspectJobTool(runtime),
    createSchemaSearchTool(runtime),
    createLaunchRunTool(runtime),
    createReexecuteRunTool(runtime),
    createTerminateRunTool(runtime),
    createBackfillTool(runtime),
    createScheduleControlTool(runtime),
    createSensorControlTool(runtime),
    createReloadLocationTool(runtime),
    createGraphqlMutationTool(runtime),
    createGraphqlSubscribeTool(runtime),
    createWatchRunTool(runtime),
    createEvidencePackTool(runtime),
    createCompareRunTool(runtime),
    createDgCommandTool(runtime),
  ];
}

/** @deprecated Prefer createLazyTools — alias for older call sites. */
export function createLazyStubTools(runtime: DagsterRuntime) {
  return createLazyTools(runtime);
}

/** Remaining stubs — empty in Phase 3. */
export function createRemainingStubTools(_runtime: DagsterRuntime) {
  return [];
}

/** Registration metadata for tests — asserts lazy tools omit prompt metadata. */
export function lazyToolPromptMetadata(): Array<{
  name: string;
  promptSnippet?: string;
  promptGuidelines?: string[];
}> {
  const fakeRuntime = {
    closed: false,
    getEffectivePolicy: () => "confirmMutations",
    getActiveProfile: () => null,
    activeProfileName: null,
    pi: { appendEntry: () => {} },
    getClient: () => null,
    getEphemeralGraphqlUrl: () => null,
    ensureClient: async () => {
      throw new Error("fake");
    },
    ensureWsClient: async () => {
      throw new Error("fake");
    },
    listWatches: () => [],
    startRunLogWatch: async () => {
      throw new Error("fake");
    },
    stopWatch: () => {},
    rememberEntity: () => {},
  } as unknown as DagsterRuntime;
  return createLazyTools(fakeRuntime).map((t) => ({
    name: t.name,
    promptSnippet: t.promptSnippet,
    promptGuidelines: t.promptGuidelines,
  }));
}

export function expectedLazyToolNames(): readonly string[] {
  return LAZY_TOOL_NAMES;
}
