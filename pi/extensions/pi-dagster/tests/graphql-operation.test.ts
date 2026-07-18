import { describe, expect, it } from "vitest";
import {
  selectGraphqlOperation,
  extractRootFieldsFromSelection,
  GraphqlOperationError,
} from "../src/graphql/operation.ts";
import { Kind, parse } from "graphql";

describe("selectGraphqlOperation", () => {
  it("selects a single query and root fields", () => {
    const sel = selectGraphqlOperation({
      document: "query Q { version repositoriesOrError { __typename } }",
      expectedType: "query",
    });
    expect(sel.type).toBe("query");
    expect(sel.name).toBe("Q");
    expect(sel.rootFields).toEqual(["version", "repositoriesOrError"]);
  });

  it("uses actual field names, not aliases", () => {
    const sel = selectGraphqlOperation({
      document: "mutation { safe: deleteRun(runId: \"x\") { __typename } }",
      expectedType: "mutation",
    });
    expect(sel.rootFields).toEqual(["deleteRun"]);
  });

  it("resolves top-level fragment spreads", () => {
    const sel = selectGraphqlOperation({
      document: `
        mutation M { ...Kill }
        fragment Kill on Mutation { deleteRun(runId: "x") { __typename } }
      `,
      expectedType: "mutation",
    });
    expect(sel.rootFields).toEqual(["deleteRun"]);
  });

  it("resolves nested inline fragments", () => {
    const sel = selectGraphqlOperation({
      document: `
        mutation {
          ... on Mutation {
            wipeAssets(assetPartitionRanges: []) { __typename }
          }
        }
      `,
      expectedType: "mutation",
    });
    expect(sel.rootFields).toContain("wipeAssets");
  });

  it("rejects multi-op without operationName", () => {
    expect(() =>
      selectGraphqlOperation({
        document: "query Q { version } mutation M { deleteRun(runId: \"x\") { __typename } }",
      }),
    ).toThrow(/operationName/i);
  });

  it("selects mutation via operationName in multi-op doc", () => {
    const sel = selectGraphqlOperation({
      document: "query Q { version } mutation M { deleteRun(runId: \"x\") { __typename } }",
      operationName: "M",
      expectedType: "mutation",
    });
    expect(sel.type).toBe("mutation");
    expect(sel.rootFields).toEqual(["deleteRun"]);
  });

  it("rejects wrong expected type", () => {
    expect(() =>
      selectGraphqlOperation({
        document: "query Q { version }",
        expectedType: "mutation",
      }),
    ).toThrow(/Expected mutation/i);
  });

  it("rejects empty or invalid empty selection", () => {
    // GraphQL forbids empty selection sets at parse time; both parse and
    // post-parse empty-root checks fail closed.
    expect(() =>
      selectGraphqlOperation({
        document: "query Q { }",
      }),
    ).toThrow(/empty|Invalid GraphQL|Syntax Error/i);
  });

  it("rejects malformed documents without echoing secret literals", () => {
    let message = "";
    try {
      selectGraphqlOperation({
        document: 'query Q { version(arg: "super-secret-credential" }',
      });
    } catch (error) {
      expect(error).toBeInstanceOf(GraphqlOperationError);
      message = error instanceof Error ? error.message : String(error);
    }
    expect(message).toMatch(/Invalid GraphQL document/);
    expect(message).not.toContain("super-secret-credential");
  });

  it("rejects cyclic fragments", () => {
    expect(() =>
      selectGraphqlOperation({
        document: `
          mutation M { ...A }
          fragment A on Mutation { ...B }
          fragment B on Mutation { ...A }
        `,
        expectedType: "mutation",
      }),
    ).toThrow(/cyclic|unknown|empty/i);
  });

  it("rejects unknown operationName", () => {
    expect(() =>
      selectGraphqlOperation({
        document: "query Q { version }",
        operationName: "Nope",
      }),
    ).toThrow(/Unknown operationName/i);
  });
});

describe("extractRootFieldsFromSelection", () => {
  it("extracts fields from a selection set AST", () => {
    const doc = parse("query { a { x } b }");
    const op = doc.definitions[0]!;
    if (op.kind !== Kind.OPERATION_DEFINITION) throw new Error("expected op");
    const fields = extractRootFieldsFromSelection(op.selectionSet.selections, new Map());
    expect(fields).toEqual(["a", "b"]);
  });
});
