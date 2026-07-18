import { describe, expect, it, vi } from "vitest";
import {
  createDagsterAutocompleteProvider,
  extractAtToken,
  extractHashToken,
  filterEntitySuggestions,
  isSafeSuggestionValue,
  MAX_SUGGESTIONS,
} from "../src/ui/autocomplete.ts";
import type { EntityReference } from "../src/state/entities.ts";
import { createEntityCache } from "../src/state/entities.ts";
import type { AutocompleteProvider } from "@earendil-works/pi-tui";

const refs: EntityReference[] = [
  { kind: "asset", id: "foo/bar", label: "foo/bar", seenAt: 3 },
  { kind: "job", id: "daily_job", label: "daily_job", seenAt: 2 },
  { kind: "run", id: "abc123", label: "abc123", description: "FAILURE daily_job", seenAt: 1 },
  { kind: "location", id: "code_loc", seenAt: 0 },
];

describe("token extraction", () => {
  it("extracts @ tokens only at start or after whitespace", () => {
    expect(extractAtToken("@fo")).toBe("fo");
    expect(extractAtToken("see @fo")).toBe("fo");
    expect(extractAtToken("email@fo")).toBeUndefined();
    expect(extractAtToken("x")).toBeUndefined();
  });

  it("extracts # run tokens", () => {
    expect(extractHashToken("#ab")).toBe("ab");
    expect(extractHashToken("run #ab")).toBe("ab");
    expect(extractHashToken("x#ab")).toBeUndefined();
  });
});

describe("filtering", () => {
  it("filters @ assets/jobs and bounds to 20", () => {
    const many: EntityReference[] = Array.from({ length: 40 }, (_, i) => ({
      kind: "asset" as const,
      id: `asset_${i}`,
      seenAt: i,
    }));
    const items = filterEntitySuggestions(many, "@", "");
    expect(items.length).toBeLessThanOrEqual(MAX_SUGGESTIONS);
    expect(items[0]?.value.startsWith("@")).toBe(true);
  });

  it("filters # runs", () => {
    const items = filterEntitySuggestions(refs, "#", "abc");
    expect(items.some((i) => i.value === "#abc123")).toBe(true);
  });

  it("rejects secret-like values", () => {
    expect(isSafeSuggestionValue("password=hunter2")).toBe(false);
    expect(isSafeSuggestionValue("@safe/asset")).toBe(true);
    expect(isSafeSuggestionValue("has space")).toBe(false);
  });
});

describe("provider delegation", () => {
  it("delegates when no token or no matches; never networks", async () => {
    const current: AutocompleteProvider = {
      getSuggestions: vi.fn(async () => ({ items: [{ value: "x", label: "x" }], prefix: "" })),
      applyCompletion: vi.fn((lines, line, col) => ({ lines, cursorLine: line, cursorCol: col })),
      shouldTriggerFileCompletion: vi.fn(() => true),
    };
    const provider = createDagsterAutocompleteProvider(current, () => refs);
    const ac = new AbortController();

    // no token
    await provider.getSuggestions(["hello"], 0, 5, { signal: ac.signal });
    expect(current.getSuggestions).toHaveBeenCalled();

    // aborted
    ac.abort();
    await provider.getSuggestions(["@fo"], 0, 3, { signal: ac.signal });
  });

  it("returns @ suggestions from local cache", async () => {
    const current: AutocompleteProvider = {
      getSuggestions: vi.fn(async () => null),
      applyCompletion: (lines, line, col) => ({ lines, cursorLine: line, cursorCol: col }),
    };
    const provider = createDagsterAutocompleteProvider(current, () => refs);
    const result = await provider.getSuggestions(["@daily"], 0, 6, {
      signal: new AbortController().signal,
    });
    expect(result?.items.some((i) => i.value === "@job:daily_job")).toBe(true);
    expect(current.getSuggestions).not.toHaveBeenCalled();
  });
});

describe("entity cache bounds", () => {
  it("bounds total and per-kind; getRecentEntities keeps 3", () => {
    const cache = createEntityCache();
    for (let i = 0; i < 50; i++) {
      cache.rememberEntity("asset", `a${i}`);
      cache.rememberEntity("run", `r${i}`);
    }
    expect(cache._size()).toBeLessThanOrEqual(100);
    expect(cache.getEntityReferences({ kinds: ["asset"] }).length).toBeLessThanOrEqual(30);
    expect(cache.getRecentEntities()).toHaveLength(3);
  });

  it("drops secret-like ids", () => {
    const cache = createEntityCache();
    cache.rememberEntity("run", "password=hunter2");
    cache.rememberEntity("run", "ok-run");
    expect(cache.getEntityReferences().map((e) => e.id)).toEqual(["ok-run"]);
  });
});
