import { describe, expect, it } from "vitest";
import {
  ROOT_FIELDS,
  searchRootFields,
} from "../src/domain/schema-index.ts";

describe("schema-search offline index", () => {
  it("contains expected root field counts", () => {
    const queries = ROOT_FIELDS.filter((f) => f.kind === "Query");
    const mutations = ROOT_FIELDS.filter((f) => f.kind === "Mutation");
    const subs = ROOT_FIELDS.filter((f) => f.kind === "Subscription");
    expect(queries).toHaveLength(65);
    expect(mutations).toHaveLength(40);
    expect(subs).toHaveLength(3);
  });

  it("finds runsOrError and launchRun", () => {
    const runs = searchRootFields("runsOrError");
    expect(runs.some((f) => f.name === "runsOrError" && f.kind === "Query")).toBe(true);

    const launch = searchRootFields("launchRun");
    expect(launch.some((f) => f.name === "launchRun" && f.kind === "Mutation")).toBe(true);

    const run = searchRootFields("run");
    expect(run.some((f) => f.name === "runOrError")).toBe(true);
  });

  it("filters by kind", () => {
    const onlyMut = searchRootFields("run", { kinds: ["Mutation"], limit: 20 });
    expect(onlyMut.every((f) => f.kind === "Mutation")).toBe(true);
    expect(onlyMut.some((f) => f.name === "launchRun" || f.name === "terminateRun")).toBe(true);
  });
});
