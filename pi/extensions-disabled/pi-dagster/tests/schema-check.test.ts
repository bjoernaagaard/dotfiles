import { describe, expect, it } from "vitest";
import {
  compareRootInventories,
  EXPECTED_COUNTS,
  parseRootFieldsMarkdown,
  parseRootFieldsMarkdownInventory,
  runSchemaCheck,
  formatSchemaCheckReport,
} from "../src/schema/check.ts";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const packageRoot = join(dirname(fileURLToPath(import.meta.url)), "..");

describe("schema check", () => {
  it("current inventories match pinned schema", () => {
    const report = runSchemaCheck(packageRoot);
    if (!report.ok) {
      // help debug
      // eslint-disable-next-line no-console
      console.error(formatSchemaCheckReport(report));
    }
    expect(report.ok).toBe(true);
    expect(report.counts.schema.Query).toBe(EXPECTED_COUNTS.Query);
    expect(report.counts.schema.Mutation).toBe(EXPECTED_COUNTS.Mutation);
    expect(report.counts.schema.Subscription).toBe(EXPECTED_COUNTS.Subscription);
  });

  it("detects missing/extra/duplicate in synthetic inventories", () => {
    const schema = {
      Query: ["version", "runsOrError"],
      Mutation: ["launchRun", "deleteRun"],
      Subscription: ["pipelineRunLogs"],
    };
    const report = compareRootInventories({
      schemaFields: schema,
      markdownFields: {
        Query: ["version"], // missing runsOrError
        Mutation: ["launchRun", "deleteRun", "extraMut"], // extra
        Subscription: ["pipelineRunLogs", "pipelineRunLogs"], // dup
      },
      runtimeFields: {
        Query: ["version", "runsOrError", "ghost"],
        Mutation: ["launchRun"],
        Subscription: ["pipelineRunLogs"],
      },
    });
    expect(report.ok).toBe(false);
    const codes = report.issues.map((i) => i.code);
    expect(codes).toContain("missing");
    expect(codes).toContain("extra");
    expect(codes).toContain("duplicate");
    expect(codes).toContain("count");
  });

  it("parses ROOT_FIELDS.md sections and declared header counts", () => {
    const md = `## Query (2)\n- \`version\`\n- \`runsOrError\`\n## Mutation (1)\n- \`launchRun\`\n## Subscription (1)\n- \`pipelineRunLogs\`\n`;
    const parsed = parseRootFieldsMarkdown(md);
    expect(parsed.Query).toEqual(["runsOrError", "version"]);
    expect(parsed.Mutation).toEqual(["launchRun"]);
    const inventory = parseRootFieldsMarkdownInventory(md);
    expect(inventory.declaredCounts).toEqual({ Query: 2, Mutation: 1, Subscription: 1 });
  });

  it("fails when markdown header count disagrees with its fields", () => {
    const fields = {
      Query: ["version"],
      Mutation: ["launchRun"],
      Subscription: ["pipelineRunLogs"],
    };
    const report = compareRootInventories({
      schemaFields: fields,
      markdownFields: fields,
      markdownDeclaredCounts: { Query: 999, Mutation: 1, Subscription: 1 },
      runtimeFields: fields,
    });
    expect(report.ok).toBe(false);
    expect(report.issues.some((issue) => issue.code === "header_count")).toBe(true);
  });
});
