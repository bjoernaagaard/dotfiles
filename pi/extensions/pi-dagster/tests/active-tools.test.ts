import { describe, expect, it } from "vitest";
import {
  ALWAYS_ON_NAMES,
  LAZY_TOOL_NAMES,
  SEARCHABLE_TOOL_NAMES,
  alwaysOnNames,
  rankCatalog,
} from "../src/tools/catalog.ts";
import { runSearchTools } from "../src/tools/loader.ts";
import {
  computeAdditiveActiveTools,
  computeSessionStartActiveTools,
  extractPreviouslyLoadedFromBranch,
  type BranchEntry,
} from "../src/state/session.ts";
import { lazyToolPromptMetadata } from "../src/tools/lazy/stubs.ts";
import { applySessionStartActiveTools } from "../src/tools/register.ts";

function mockPi(initial: string[]) {
  let active = [...initial];
  return {
    getActiveTools: () => [...active],
    setActiveTools: (names: string[]) => {
      active = [...names];
    },
  };
}

function mockRuntime(loaded: string[] = []) {
  const loadedLazyTools = new Set(loaded);
  return {
    getLoadedLazyTools: () => [...loadedLazyTools],
    reconstructFromBranch: (sessionManager: { getBranch(): BranchEntry[] }) => {
      const prev = extractPreviouslyLoadedFromBranch(sessionManager.getBranch());
      loadedLazyTools.clear();
      for (const n of prev) loadedLazyTools.add(n);
    },
    markToolsLoaded: (names: string[]) => {
      for (const n of names) loadedLazyTools.add(n);
    },
    loadedLazyTools,
  };
}

describe("session_start active set", () => {
  it("includes all always-on and excludes searchable lazy tools", () => {
    const next = computeSessionStartActiveTools({
      current: ["read", "bash", ...ALWAYS_ON_NAMES, ...LAZY_TOOL_NAMES],
      alwaysOn: alwaysOnNames(),
      searchable: SEARCHABLE_TOOL_NAMES,
      previouslyLoaded: [],
    });

    for (const name of ALWAYS_ON_NAMES) {
      expect(next).toContain(name);
    }
    for (const name of LAZY_TOOL_NAMES) {
      expect(next).not.toContain(name);
    }
    expect(next).toContain("read");
    expect(next).toContain("bash");
  });

  it("restores previously loaded searchable tools from branch details.added", () => {
    const branch: BranchEntry[] = [
      {
        type: "message",
        message: {
          role: "toolResult",
          toolName: "dagster_search_tools",
          details: {
            matches: ["dagster_inspect_asset", "dagster_inspect_run"],
            added: ["dagster_inspect_asset", "dagster_inspect_run"],
          },
        },
      },
    ];
    const previouslyLoaded = extractPreviouslyLoadedFromBranch(branch);
    expect(previouslyLoaded).toEqual([
      "dagster_inspect_asset",
      "dagster_inspect_run",
    ]);

    const next = computeSessionStartActiveTools({
      current: ["read", ...ALWAYS_ON_NAMES],
      alwaysOn: alwaysOnNames(),
      searchable: SEARCHABLE_TOOL_NAMES,
      previouslyLoaded,
    });

    expect(next).toContain("dagster_inspect_asset");
    expect(next).toContain("dagster_inspect_run");
    expect(next).not.toContain("dagster_launch_run");
  });

  it("applySessionStartActiveTools wires mock pi + runtime", () => {
    const pi = mockPi(["read", "bash", "foreign_tool", "dagster_inspect_run"]);
    const runtime = mockRuntime();
    const branch: BranchEntry[] = [
      {
        type: "message",
        message: {
          role: "toolResult",
          toolName: "dagster_search_tools",
          details: { matches: ["dagster_inspect_asset"], added: ["dagster_inspect_asset"] },
          addedToolNames: ["dagster_inspect_asset"],
        },
      },
    ];

    const next = applySessionStartActiveTools(
      pi,
      runtime as never,
      { getBranch: () => branch },
    );

    expect(next).toContain("read");
    expect(next).toContain("bash");
    expect(next).toContain("foreign_tool");
    for (const name of ALWAYS_ON_NAMES) {
      expect(next).toContain(name);
    }
    expect(next).toContain("dagster_inspect_asset");
    // searchable that was active but not previously loaded is dropped
    expect(next).not.toContain("dagster_inspect_run");
  });
});

describe("additive load", () => {
  it("loader adds matching tools without removing others", () => {
    const active = [...ALWAYS_ON_NAMES, "read", "bash", "foreign_tool"];
    let current = [...active];

    const details = runSearchTools({
      query: "inspect asset",
      getActiveTools: () => current,
      setActiveTools: (names) => {
        current = names;
      },
      markToolsLoaded: () => {},
    });

    expect(details.matches).toContain("dagster_inspect_asset");
    expect(details.added).toContain("dagster_inspect_asset");
    expect(current).toContain("read");
    expect(current).toContain("bash");
    expect(current).toContain("foreign_tool");
    for (const name of ALWAYS_ON_NAMES) {
      expect(current).toContain(name);
    }
  });

  it("loader never removes an already-active lazy tool", () => {
    let current = [...ALWAYS_ON_NAMES, "dagster_inspect_asset", "read"];

    const details = runSearchTools({
      query: "inspect run",
      getActiveTools: () => current,
      setActiveTools: (names) => {
        current = names;
      },
      markToolsLoaded: () => {},
    });

    expect(details.matches).toContain("dagster_inspect_run");
    expect(details.added).toContain("dagster_inspect_run");
    expect(current).toContain("dagster_inspect_asset");
    expect(current).toContain("dagster_inspect_run");
    expect(current).toContain("read");
  });

  it("details.added is the stable replay record", () => {
    const { next, added } = computeAdditiveActiveTools(
      ["dagster_search_tools", "read"],
      ["dagster_inspect_asset", "dagster_search_tools"],
    );
    expect(added).toEqual(["dagster_inspect_asset"]);
    expect(next).toEqual([
      "dagster_search_tools",
      "read",
      "dagster_inspect_asset",
    ]);

    const branch: BranchEntry[] = [
      {
        type: "message",
        message: {
          role: "toolResult",
          toolName: "dagster_search_tools",
          details: { matches: ["dagster_inspect_asset"], added },
        },
      },
    ];
    expect(extractPreviouslyLoadedFromBranch(branch)).toEqual(added);
  });

  it("new lazy tools (job/schema) are searchable and not always-on", () => {
    expect(SEARCHABLE_TOOL_NAMES.has("dagster_inspect_job")).toBe(true);
    expect(SEARCHABLE_TOOL_NAMES.has("dagster_schema_search")).toBe(true);
    expect(ALWAYS_ON_NAMES).not.toContain("dagster_inspect_job");
    expect(ALWAYS_ON_NAMES).not.toContain("dagster_schema_search");

    const rankedJob = rankCatalog("inspect job", { limit: 5 });
    expect(rankedJob.some((t) => t.name === "dagster_inspect_job")).toBe(true);

    const rankedSchema = rankCatalog("schema graphql root", { limit: 5 });
    expect(rankedSchema.some((t) => t.name === "dagster_schema_search")).toBe(true);
  });
});

describe("foreign tools preserved", () => {
  it("preserves read/bash/foreign_tool after session_start logic and loader", () => {
    let current = ["read", "bash", "foreign_tool", ...ALWAYS_ON_NAMES, "dagster_launch_run"];

    current = computeSessionStartActiveTools({
      current,
      alwaysOn: alwaysOnNames(),
      searchable: SEARCHABLE_TOOL_NAMES,
      previouslyLoaded: [],
    });

    expect(current).toContain("read");
    expect(current).toContain("bash");
    expect(current).toContain("foreign_tool");
    expect(current).not.toContain("dagster_launch_run");

    const details = runSearchTools({
      query: "launch run",
      getActiveTools: () => current,
      setActiveTools: (names) => {
        current = names;
      },
      markToolsLoaded: () => {},
    });

    expect(details.added.length).toBeGreaterThan(0);
    expect(current).toContain("read");
    expect(current).toContain("bash");
    expect(current).toContain("foreign_tool");
  });
});

describe("lazy tools lack prompt metadata", () => {
  it("omits promptSnippet and promptGuidelines on all lazy tools", () => {
    const metas = lazyToolPromptMetadata();
    expect(metas.length).toBe(LAZY_TOOL_NAMES.length);
    for (const meta of metas) {
      expect(meta.promptSnippet).toBeUndefined();
      expect(meta.promptGuidelines).toBeUndefined();
    }
  });

  it("Phase 4 diagnosis tools are lazy, searchable, and omit prompt metadata", () => {
    for (const name of ["dagster_evidence_pack", "dagster_compare_run"]) {
      expect(SEARCHABLE_TOOL_NAMES.has(name)).toBe(true);
      expect(ALWAYS_ON_NAMES).not.toContain(name);
    }
    expect(rankCatalog("diagnose failure evidence logs", { limit: 12 }).some((t) => t.name === "dagster_evidence_pack")).toBe(true);
    expect(rankCatalog("compare baseline last success", { limit: 12 }).some((t) => t.name === "dagster_compare_run")).toBe(true);
    const metadata = lazyToolPromptMetadata().filter((item) => ["dagster_evidence_pack", "dagster_compare_run"].includes(item.name));
    expect(metadata).toHaveLength(2);
    expect(metadata.every((item) => item.promptSnippet === undefined && item.promptGuidelines === undefined)).toBe(true);
  });

  it("dagster_dg_command is lazy, searchable, not always-on", () => {
    expect(SEARCHABLE_TOOL_NAMES.has("dagster_dg_command")).toBe(true);
    expect(ALWAYS_ON_NAMES).not.toContain("dagster_dg_command");
    const ranked = rankCatalog("dg check scaffold", { limit: 5 });
    expect(ranked.some((t) => t.name === "dagster_dg_command")).toBe(true);
  });

  it("Phase 3 mutation tools are searchable, no prompt metadata, not always-on", () => {
    const names = [
      "dagster_launch_run",
      "dagster_reexecute_run",
      "dagster_terminate_run",
      "dagster_backfill",
      "dagster_schedule_control",
      "dagster_sensor_control",
      "dagster_reload_location",
      "dagster_graphql_mutation",
      "dagster_graphql_subscribe",
      "dagster_watch_run",
    ];
    for (const name of names) {
      expect(SEARCHABLE_TOOL_NAMES.has(name)).toBe(true);
      expect(ALWAYS_ON_NAMES).not.toContain(name);
    }
    const ranked = rankCatalog("launch terminate watch mutation", { limit: 12 });
    expect(ranked.some((t) => t.name === "dagster_launch_run")).toBe(true);
    expect(ranked.some((t) => t.name === "dagster_watch_run")).toBe(true);
  });
});

describe("rankCatalog", () => {
  it("ranks by keyword overlap and respects max 12", () => {
    const ranked = rankCatalog("asset inspect", { limit: 12 });
    expect(ranked[0]?.name).toBe("dagster_inspect_asset");
    expect(ranked.length).toBeLessThanOrEqual(12);
  });
});
