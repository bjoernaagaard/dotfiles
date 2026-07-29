import { describe, expect, it } from "vitest";
import { formatSearchHits, rankSearchHits } from "../src/domain/search.ts";

describe("rankSearchHits", () => {
  it("merges assets/jobs/runs and ranks by keyword overlap", () => {
    const hits = rankSearchHits({
      query: "orders",
      assets: [
        { path: ["orders", "daily"], groupName: "analytics", description: "Daily orders" },
        { path: ["users", "raw"], groupName: "core" },
      ],
      jobs: [
        { name: "orders_job", description: "Materialize orders" },
        { name: "users_job", description: "Users" },
      ],
      runs: [
        { runId: "abc-orders-1", jobName: "orders_job", status: "SUCCESS" },
        { runId: "zzz", jobName: "users_job", status: "FAILURE" },
      ],
      schedules: [{ name: "orders_daily", cronSchedule: "0 1 * * *" }],
      sensors: [{ name: "orders_sensor" }],
      limit: 20,
    });

    expect(hits.length).toBeGreaterThan(0);
    expect(hits.some((h) => h.kind === "asset" && h.id === "orders/daily")).toBe(true);
    expect(hits.some((h) => h.kind === "job" && h.id === "orders_job")).toBe(true);
    expect(hits.some((h) => h.kind === "run" && h.id === "abc-orders-1")).toBe(true);
    // Unrelated entities should score lower / often drop when terms are specific
    expect(hits.every((h) => h.id.toLowerCase().includes("orders") || h.label.toLowerCase().includes("orders"))).toBe(
      true,
    );
  });

  it("respects limit and kinds filter", () => {
    const hits = rankSearchHits({
      query: "x",
      assets: [
        { path: ["x", "a"] },
        { path: ["x", "b"] },
        { path: ["x", "c"] },
      ],
      jobs: [{ name: "x_job" }],
      kinds: ["asset"],
      limit: 2,
    });
    expect(hits).toHaveLength(2);
    expect(hits.every((h) => h.kind === "asset")).toBe(true);
  });

  it("formatSearchHits is compact", () => {
    const text = formatSearchHits([
      { kind: "asset", id: "a/b", label: "a/b", extra: { groupName: "g" } },
    ]);
    expect(text).toContain("[asset]");
    expect(text).toContain("a/b");
  });
});
