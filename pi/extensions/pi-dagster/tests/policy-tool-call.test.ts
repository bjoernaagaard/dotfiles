import { describe, expect, it } from "vitest";
import { evaluateToolCallPolicy } from "../src/policy/tool-call.ts";

describe("tool_call policy handler", () => {
  it("blocks remote_launch under readOnly", () => {
    const result = evaluateToolCallPolicy({
      toolName: "dagster_launch_run",
      toolInput: { jobName: "x", force: true },
      policy: "readOnly",
      hasUI: false,
    });
    expect(result).toEqual({
      block: true,
      reason: expect.stringContaining("Blocked by policy"),
    });
  });

  it("blocks remote_launch under confirmMutations without force and no UI", () => {
    const result = evaluateToolCallPolicy({
      toolName: "dagster_launch_run",
      toolInput: { jobName: "x" },
      policy: "confirmMutations",
      hasUI: false,
    });
    expect(result?.block).toBe(true);
  });

  it("allows through for confirm (execute will confirm)", () => {
    const result = evaluateToolCallPolicy({
      toolName: "dagster_launch_run",
      toolInput: { jobName: "x" },
      policy: "confirmMutations",
      hasUI: true,
    });
    expect(result).toBeUndefined();
  });

  it("allows force path in non-UI", () => {
    const result = evaluateToolCallPolicy({
      toolName: "dagster_launch_run",
      toolInput: { jobName: "x", force: true },
      policy: "confirmMutations",
      hasUI: false,
    });
    expect(result).toBeUndefined();
  });

  it("ignores unknown / read tools", () => {
    expect(
      evaluateToolCallPolicy({
        toolName: "dagster_search",
        toolInput: {},
        policy: "readOnly",
        hasUI: false,
      }),
    ).toBeUndefined();

    expect(
      evaluateToolCallPolicy({
        toolName: "not_ours",
        toolInput: {},
        policy: "readOnly",
        hasUI: false,
      }),
    ).toBeUndefined();
  });

  it("refines generic mutation risk for block", () => {
    const result = evaluateToolCallPolicy({
      toolName: "dagster_graphql_mutation",
      toolInput: {
        mutation: "mutation { deleteRun(runId: \"x\") { __typename } }",
      },
      policy: "confirmMutations",
      hasUI: false,
    });
    expect(result?.block).toBe(true);
    expect(result?.reason).toMatch(/destructive/);
  });
});
