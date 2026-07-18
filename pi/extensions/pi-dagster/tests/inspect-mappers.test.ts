import { describe, expect, it } from "vitest";
import { mapAssetNodeOrError, parseAssetKeyInput } from "../src/domain/asset.ts";
import { mapRunOrError } from "../src/domain/run.ts";
import assetFixture from "./fixtures/graphql/asset-node.json" with { type: "json" };
import runOk from "./fixtures/graphql/run-ok.json" with { type: "json" };
import runPythonError from "./fixtures/graphql/run-python-error.json" with { type: "json" };
import runNotFound from "./fixtures/graphql/run-not-found.json" with { type: "json" };

describe("parseAssetKeyInput", () => {
  it("accepts slash paths and JSON arrays", () => {
    expect(parseAssetKeyInput("orders/daily")).toEqual(["orders", "daily"]);
    expect(parseAssetKeyInput('["orders","daily"]')).toEqual(["orders", "daily"]);
    expect(parseAssetKeyInput(["a", "b"])).toEqual(["a", "b"]);
  });
});

describe("mapAssetNodeOrError", () => {
  it("maps assetNode fixture to summary shape", () => {
    const result = mapAssetNodeOrError(assetFixture as never);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.asset.assetKey).toBe("orders/daily");
    expect(result.asset.groupName).toBe("analytics");
    expect(result.asset.jobNames).toContain("analytics_job");
    expect(result.asset.owners).toEqual(["data@example.com", "team:analytics"]);
    expect(result.asset.dependencyKeys).toEqual(["orders/raw"]);
    expect(result.asset.recentMaterializations?.[0]?.runId).toBe("run-abc");
    expect(result.asset.freshnessStatus).toBe("HEALTHY");
  });

  it("maps not found union", () => {
    const result = mapAssetNodeOrError({
      assetNodeOrError: {
        __typename: "AssetNotFoundError",
        message: "Asset not found",
      },
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.kind).toBe("NotFound");
    expect(result.error.message).toContain("not found");
  });
});

describe("mapRunOrError", () => {
  it("maps run and redacts runConfigYaml", () => {
    const result = mapRunOrError(runOk as never);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.run.runId).toBe("run-123");
    expect(result.run.status).toBe("FAILURE");
    expect(result.run.assetSelection).toEqual(["orders/daily"]);
    expect(result.run.runConfigYamlRedacted).toContain("[REDACTED]");
    expect(result.run.runConfigYamlRedacted).not.toContain("s3cret");
    expect(result.run.runConfigYamlRedacted).not.toContain("abc123");
    expect(result.run.runConfigYamlRedacted).toContain("table: orders");
  });

  it("maps PythonError union to error details", () => {
    const result = mapRunOrError(runPythonError as never);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.kind).toBe("PythonError");
    expect(result.error.message).toContain("storage unavailable");
  });

  it("maps not found union", () => {
    const result = mapRunOrError(runNotFound as never);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.kind).toBe("NotFound");
    expect(result.error.typename).toBe("RunNotFoundError");
  });
});
