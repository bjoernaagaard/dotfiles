import { describe, expect, it } from "vitest";
import {
  detailsContainSecretKeys,
  extractSafeCallArguments,
  extractSafeSummary,
  filterDetailsForRender,
} from "../src/render/index.ts";

describe("extractSafeSummary", () => {
  it("compacts mutation outcomes with allowlisted fields", () => {
    const summary = extractSafeSummary("dagster_launch_run", {
      content: [{ type: "text", text: "launched" }],
      details: {
        kind: "mutation_ok",
        risk: "remote_launch",
        entityIds: ["run-1"],
        typename: "LaunchRunSuccess",
        variables: { runConfig: { secrets: "x" } },
        headers: { Authorization: "Bearer tok" },
      },
    });
    expect(summary.compact).toMatch(/mutation_ok/);
    expect(summary.compact).toMatch(/run-1|ids=/);
    expect(summary.expanded.join("\n")).not.toMatch(/Bearer|runConfig|secrets/);
  });

  it("handles partial and error states", () => {
    const partial = extractSafeSummary("dagster_watch_run", {}, { isPartial: true });
    expect(partial.compact).toMatch(/…/);
    const err = extractSafeSummary(
      "dagster_terminate_run",
      { details: { kind: "error", message: "nope" } },
      { isError: true },
    );
    expect(err.isError).toBe(true);
  });

  it("subscription summary includes counts/path only", () => {
    const summary = extractSafeSummary("dagster_graphql_subscribe", {
      details: {
        kind: "subscription",
        eventCount: 3,
        completionReason: "max_events",
        overflowPath: "/tmp/x.jsonl",
        events: [{ secret: "nope" }],
        variables: { token: "x" },
      },
    });
    expect(summary.compact).toMatch(/events=3/);
    expect(summary.compact).toMatch(/max_events/);
    expect(JSON.stringify(summary)).not.toMatch(/secret|token/);
  });

  it("dg command omits env", () => {
    const summary = extractSafeSummary("dagster_dg_command", {
      details: {
        kind: "dg_ok",
        exitCode: 0,
        argvSummary: "dg check defs",
        env: { SECRET: "x" },
      },
    });
    expect(summary.compact).toMatch(/exit=0/);
    expect(JSON.stringify(summary)).not.toMatch(/SECRET/);
  });

  it("filterDetailsForRender strips secret keys", () => {
    const filtered = filterDetailsForRender({
      kind: "ok",
      runId: "r1",
      variables: { a: 1 },
      runConfig: {},
      headers: {},
      password: "x",
    });
    expect(filtered.runId).toBe("r1");
    expect(filtered.variables).toBeUndefined();
    expect(filtered.runConfig).toBeUndefined();
    expect(filtered.password).toBeUndefined();
    expect(detailsContainSecretKeys({ password: "x" })).toBe(true);
    expect(detailsContainSecretKeys(filtered)).toBe(false);
  });

  it("never renders GraphQL documents, literals, or variables in call rows", () => {
    const args = extractSafeCallArguments({
      query: 'query { secret(value: "hunter2") }',
      mutation: 'mutation { setSensorCursor(cursor: "opaque") { __typename } }',
      subscription: 'subscription { capturedLogs(logKey: ["secret"]) { stdout } }',
      variables: { token: "api-token" },
      operationName: "SafeOperation",
      force: true,
    });
    const rendered = args.join(" ");
    expect(rendered).toContain("operationName=SafeOperation");
    expect(rendered).toContain("force=true");
    expect(rendered).not.toMatch(/hunter2|opaque|api-token|capturedLogs|secret\(/);
  });

  it("bounds expanded lines", () => {
    const summary = extractSafeSummary("dagster_evidence_pack", {
      content: [{ type: "text", text: "line1\nline2\nline3" }],
      details: {
        kind: "evidence_pack",
        runId: "r1",
        evidencePointer: "/tmp/e",
        classificationHints: ["a", "b"],
      },
    });
    expect(summary.expanded.length).toBeLessThanOrEqual(20);
  });
});
