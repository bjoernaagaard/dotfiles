import { describe, expect, it } from "vitest";
import {
  classifyMutationDocument,
  extractMutationRootFields,
  refineToolRisk,
} from "../src/policy/mutation-risk.ts";
import { assertAllowed } from "../src/policy/risk.ts";

describe("classifyMutationDocument", () => {
  it("classifies launch family as remote_launch", () => {
    expect(classifyMutationDocument("mutation { launchRun(executionParams: $p) { __typename } }")).toBe(
      "remote_launch",
    );
    expect(
      classifyMutationDocument(
        "mutation X { launchPartitionBackfill(backfillParams: $b) { __typename } }",
      ),
    ).toBe("remote_launch");
    expect(
      classifyMutationDocument("mutation { launchRunReexecution(reexecutionParams: $r) { __typename } }"),
    ).toBe("remote_launch");
  });

  it("classifies destructive fields", () => {
    expect(classifyMutationDocument("mutation { deleteRun(runId: $id) { __typename } }")).toBe(
      "destructive",
    );
    expect(classifyMutationDocument("mutation { wipeAssets(assetPartitionRanges: []) { __typename } }")).toBe(
      "destructive",
    );
  });

  it("classifies remote_state fields", () => {
    expect(classifyMutationDocument("mutation { terminateRun(runId: $id) { __typename } }")).toBe(
      "remote_state",
    );
    expect(
      classifyMutationDocument("mutation { reloadRepositoryLocation(repositoryLocationName: $n) { __typename } }"),
    ).toBe("remote_state");
  });

  it("defaults unknown roots to remote_state", () => {
    expect(classifyMutationDocument("mutation { someFutureField { id } }")).toBe("remote_state");
  });

  it("rejects empty, query, and shorthand-query docs", () => {
    expect(() => classifyMutationDocument("   ")).toThrow(/empty/i);
    expect(() => classifyMutationDocument("query { version }")).toThrow(/query/i);
    expect(() =>
      classifyMutationDocument('{ deleteRun(runId: "x") { __typename } }'),
    ).toThrow(/query|Expected mutation/i);
  });

  it("rejects telemetry noise", () => {
    expect(() => classifyMutationDocument("mutation { logTelemetry(action: \"x\", clientId: \"y\", clientTime: \"z\", metadata: \"{}\") { __typename } }")).toThrow(
      /unsupported/i,
    );
  });

  it("handles standard GraphQL # comments and rejects non-standard block comments", () => {
    const fields = extractMutationRootFields(`
      # comment
      mutation {
        # another comment
        terminateRun(runId: "x") { __typename }
      }
    `);
    expect(fields).toContain("terminateRun");
    expect(() =>
      classifyMutationDocument(`mutation { /* not GraphQL */ terminateRun(runId: "x") { __typename } }`),
    ).toThrow(/Invalid GraphQL|Syntax Error/i);
  });

  it("classifies destructive field hidden behind alias", () => {
    expect(
      classifyMutationDocument("mutation { safe: deleteRun(runId: \"x\") { __typename } }"),
    ).toBe("destructive");
  });

  it("classifies destructive field inside top-level fragment spread", () => {
    expect(
      classifyMutationDocument(`
        mutation M { ...Kill }
        fragment Kill on Mutation { wipeAssets(assetPartitionRanges: []) { __typename } }
      `),
    ).toBe("destructive");
  });

  it("honors operationName for multi-op documents", () => {
    const doc =
      "query Q { version } mutation M { deleteRun(runId: \"x\") { __typename } }";
    expect(classifyMutationDocument(doc, "M")).toBe("destructive");
  });
});

describe("print/json fail-closed matrix via assertAllowed", () => {
  it("confirmMutations + remote_launch without force blocks when hasUI=false", () => {
    expect(
      assertAllowed({
        risk: "remote_launch",
        policy: "confirmMutations",
        hasUI: false,
        force: false,
      }),
    ).toBe("block");
  });

  it("confirmMutations + remote_launch with force allows when hasUI=false", () => {
    expect(
      assertAllowed({
        risk: "remote_launch",
        policy: "confirmMutations",
        hasUI: false,
        force: true,
      }),
    ).toBe("allow");
  });

  it("confirmMutations + remote_launch with UI asks confirm", () => {
    expect(
      assertAllowed({
        risk: "remote_launch",
        policy: "confirmMutations",
        hasUI: true,
      }),
    ).toBe("confirm");
  });

  it("readOnly blocks remote_launch even with force", () => {
    expect(
      assertAllowed({
        risk: "remote_launch",
        policy: "readOnly",
        hasUI: false,
        force: true,
      }),
    ).toBe("block");
  });
});

describe("refineToolRisk", () => {
  it("refines graphql mutation from document", () => {
    expect(
      refineToolRisk(
        "dagster_graphql_mutation",
        { mutation: "mutation { launchRun(executionParams: $p) { __typename } }" },
        "remote_state",
      ),
    ).toBe("remote_launch");
  });

  it("refines with operationName for multi-op alias risk", () => {
    expect(
      refineToolRisk(
        "dagster_graphql_mutation",
        {
          mutation:
            "query Q { version } mutation M { safe: deleteRun(runId: \"x\") { __typename } }",
          operationName: "M",
        },
        "remote_state",
      ),
    ).toBe("destructive");
  });

  it("refines backfill action", () => {
    expect(refineToolRisk("dagster_backfill", { action: "launch" }, "remote_launch")).toBe(
      "remote_launch",
    );
    expect(refineToolRisk("dagster_backfill", { action: "cancel" }, "remote_launch")).toBe(
      "remote_state",
    );
  });
});
