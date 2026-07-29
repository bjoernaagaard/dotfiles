import { describe, expect, it } from "vitest";
import {
  searchHitEditorToken,
} from "../src/domain/cross-search.ts";
import { searchHitsToSelectItems } from "../src/ui/search-overlay.ts";
import type { SearchHit } from "../src/domain/search.ts";

describe("search overlay helpers", () => {
  const hits: SearchHit[] = [
    { kind: "asset", id: "a/b", label: "a/b" },
    { kind: "job", id: "daily", label: "daily" },
    { kind: "run", id: "run1", label: "run1 (daily)", extra: { status: "FAILURE" } },
  ];

  it("builds safe editor tokens", () => {
    expect(searchHitEditorToken(hits[0]!)).toBe("@a/b");
    expect(searchHitEditorToken(hits[1]!)).toBe("@job:daily");
    expect(searchHitEditorToken(hits[2]!)).toBe("#run1");
  });

  it("maps to select items max 20 without secrets", () => {
    const many = Array.from({ length: 30 }, (_, i) => ({
      kind: "asset" as const,
      id: `a${i}`,
      label: `a${i}`,
      extra: { password: "nope" },
    }));
    const items = searchHitsToSelectItems(many);
    expect(items.length).toBe(20);
    expect(JSON.stringify(items)).not.toMatch(/password/);
  });
});
