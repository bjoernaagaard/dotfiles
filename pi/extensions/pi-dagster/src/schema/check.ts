/**
 * Offline schema drift / root inventory check.
 * Compares pinned schema.graphql, ROOT_FIELDS.md, and runtime ROOT_FIELDS.
 * No network / live introspection.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildSchema, type GraphQLSchema } from "graphql";
import { ROOT_FIELDS } from "../domain/schema-index.ts";
import { ALWAYS_ON_NAMES, LAZY_TOOL_NAMES } from "../tools/catalog.ts";

export type RootKind = "Query" | "Mutation" | "Subscription";

export type SchemaCheckIssue = {
  severity: "error" | "warning";
  code: string;
  message: string;
};

export type SchemaCheckReport = {
  ok: boolean;
  issues: SchemaCheckIssue[];
  counts: {
    schema: Record<RootKind, number>;
    markdown: Record<RootKind, number>;
    runtime: Record<RootKind, number>;
  };
  expected: Record<RootKind, number>;
};

export const EXPECTED_COUNTS: Record<RootKind, number> = {
  Query: 65,
  Mutation: 40,
  Subscription: 3,
};

/** Mutation fields intentionally unsupported (UI noise). */
export const UNSUPPORTED_MUTATIONS = new Set(["logTelemetry", "setNuxSeen"]);

/** Optional query fields with low value — still reachable via generic query. */
export const OPTIONAL_QUERY_NOTES = new Set(["shouldShowNux", "test"]);

export function defaultSchemaPaths(packageRoot?: string): {
  schemaGraphql: string;
  rootFieldsMd: string;
} {
  const root =
    packageRoot ??
    join(dirname(fileURLToPath(import.meta.url)), "..", "..");
  return {
    schemaGraphql: join(root, "sources/dagster-oss/graphql/schema.graphql"),
    rootFieldsMd: join(root, "sources/dagster-oss/graphql/ROOT_FIELDS.md"),
  };
}

export function extractSchemaRootFields(
  schemaSource: string,
): Record<RootKind, string[]> {
  const schema: GraphQLSchema = buildSchema(schemaSource);
  const out: Record<RootKind, string[]> = {
    Query: [],
    Mutation: [],
    Subscription: [],
  };
  for (const kind of ["Query", "Mutation", "Subscription"] as const) {
    const t = schema.getType(kind);
    if (t && "getFields" in t) {
      out[kind] = Object.keys(
        (t as { getFields(): Record<string, unknown> }).getFields(),
      ).sort();
    }
  }
  return out;
}

export type MarkdownRootInventory = {
  fields: Record<RootKind, string[]>;
  declaredCounts: Partial<Record<RootKind, number>>;
};

export function parseRootFieldsMarkdownInventory(md: string): MarkdownRootInventory {
  const fields: Record<RootKind, string[]> = {
    Query: [],
    Mutation: [],
    Subscription: [],
  };
  const declaredCounts: Partial<Record<RootKind, number>> = {};
  let current: RootKind | null = null;
  for (const line of md.split(/\r?\n/)) {
    const header = line.match(
      /^##\s+(Query|Mutation|Subscription)\s*\((\d+)\)\s*$/i,
    );
    if (header) {
      const raw = header[1]!.toLowerCase();
      current = raw === "query" ? "Query" : raw === "mutation" ? "Mutation" : "Subscription";
      declaredCounts[current] = Number(header[2]);
      continue;
    }
    const field = line.match(/^-\s+`([A-Za-z_][A-Za-z0-9_]*)`/);
    if (field && current) {
      fields[current].push(field[1]!);
    }
  }
  for (const k of Object.keys(fields) as RootKind[]) {
    fields[k] = fields[k]!.slice().sort();
  }
  return { fields, declaredCounts };
}

export function parseRootFieldsMarkdown(md: string): Record<RootKind, string[]> {
  return parseRootFieldsMarkdownInventory(md).fields;
}

export function runtimeRootFieldsByKind(): Record<RootKind, string[]> {
  const out: Record<RootKind, string[]> = {
    Query: [],
    Mutation: [],
    Subscription: [],
  };
  for (const f of ROOT_FIELDS) {
    out[f.kind].push(f.name);
  }
  for (const k of Object.keys(out) as RootKind[]) {
    out[k] = out[k]!.slice().sort();
  }
  return out;
}

function diffSets(
  label: string,
  expected: string[],
  actual: string[],
): SchemaCheckIssue[] {
  const issues: SchemaCheckIssue[] = [];
  const exp = new Set(expected);
  const act = new Set(actual);
  const missing = expected.filter((x) => !act.has(x));
  const extra = actual.filter((x) => !exp.has(x));
  const dupes = actual.filter((x, i) => actual.indexOf(x) !== i);
  if (missing.length) {
    issues.push({
      severity: "error",
      code: "missing",
      message: `${label} missing vs schema: ${missing.join(", ")}`,
    });
  }
  if (extra.length) {
    issues.push({
      severity: "error",
      code: "extra",
      message: `${label} extra vs schema: ${extra.join(", ")}`,
    });
  }
  if (dupes.length) {
    issues.push({
      severity: "error",
      code: "duplicate",
      message: `${label} duplicates: ${[...new Set(dupes)].join(", ")}`,
    });
  }
  return issues;
}

/**
 * Compare inventories. `schemaFields` is source of truth from buildSchema.
 */
export function compareRootInventories(input: {
  schemaFields: Record<RootKind, string[]>;
  markdownFields: Record<RootKind, string[]>;
  markdownDeclaredCounts?: Partial<Record<RootKind, number>>;
  runtimeFields: Record<RootKind, string[]>;
}): SchemaCheckReport {
  const issues: SchemaCheckIssue[] = [];
  const counts = {
    schema: {} as Record<RootKind, number>,
    markdown: {} as Record<RootKind, number>,
    runtime: {} as Record<RootKind, number>,
  };

  for (const kind of ["Query", "Mutation", "Subscription"] as const) {
    const schema = input.schemaFields[kind] ?? [];
    const md = input.markdownFields[kind] ?? [];
    const rt = input.runtimeFields[kind] ?? [];
    counts.schema[kind] = schema.length;
    counts.markdown[kind] = md.length;
    counts.runtime[kind] = rt.length;

    if (schema.length !== EXPECTED_COUNTS[kind]) {
      issues.push({
        severity: "error",
        code: "count",
        message: `Schema ${kind} count ${schema.length} != expected ${EXPECTED_COUNTS[kind]}`,
      });
    }
    if (md.length !== EXPECTED_COUNTS[kind]) {
      issues.push({
        severity: "error",
        code: "count",
        message: `Markdown ${kind} count ${md.length} != expected ${EXPECTED_COUNTS[kind]}`,
      });
    }
    const declared = input.markdownDeclaredCounts?.[kind];
    if (declared == null) {
      if (input.markdownDeclaredCounts) {
        issues.push({
          severity: "error",
          code: "header_count",
          message: `Markdown ${kind} header count is missing`,
        });
      }
    } else if (declared !== md.length || declared !== schema.length) {
      issues.push({
        severity: "error",
        code: "header_count",
        message: `Markdown ${kind} header declares ${declared}, fields=${md.length}, schema=${schema.length}`,
      });
    }
    if (rt.length !== EXPECTED_COUNTS[kind]) {
      issues.push({
        severity: "error",
        code: "count",
        message: `Runtime ${kind} count ${rt.length} != expected ${EXPECTED_COUNTS[kind]}`,
      });
    }

    issues.push(...diffSets(`Markdown ${kind}`, schema, md));
    issues.push(...diffSets(`Runtime ${kind}`, schema, rt));
  }

  // Generic reachability tools must actually be registered in the catalog.
  const requiredGenericTools = [
    ["dagster_graphql_query", ALWAYS_ON_NAMES as readonly string[]],
    ["dagster_graphql_mutation", LAZY_TOOL_NAMES as readonly string[]],
    ["dagster_graphql_subscribe", LAZY_TOOL_NAMES as readonly string[]],
  ] as const;
  for (const [tool, names] of requiredGenericTools) {
    if (!names.includes(tool)) {
      issues.push({
        severity: "error",
        code: "reachability",
        message: `Required generic reachability tool is not registered: ${tool}`,
      });
    }
  }

  // Explicit unsupported must exist in schema
  for (const u of UNSUPPORTED_MUTATIONS) {
    if (!input.schemaFields.Mutation.includes(u)) {
      issues.push({
        severity: "error",
        code: "unsupported_missing",
        message: `Unsupported mutation "${u}" not present in schema`,
      });
    }
  }

  return {
    ok: issues.filter((i) => i.severity === "error").length === 0,
    issues,
    counts,
    expected: { ...EXPECTED_COUNTS },
  };
}

export function runSchemaCheck(packageRoot?: string): SchemaCheckReport {
  const paths = defaultSchemaPaths(packageRoot);
  const schemaSource = readFileSync(paths.schemaGraphql, "utf8");
  const mdSource = readFileSync(paths.rootFieldsMd, "utf8");
  const markdown = parseRootFieldsMarkdownInventory(mdSource);
  return compareRootInventories({
    schemaFields: extractSchemaRootFields(schemaSource),
    markdownFields: markdown.fields,
    markdownDeclaredCounts: markdown.declaredCounts,
    runtimeFields: runtimeRootFieldsByKind(),
  });
}

export function formatSchemaCheckReport(report: SchemaCheckReport): string {
  if (report.ok) {
    return [
      "schema:check OK",
      `  Query: ${report.counts.schema.Query} (schema=md=runtime=${report.expected.Query})`,
      `  Mutation: ${report.counts.schema.Mutation} (schema=md=runtime=${report.expected.Mutation})`,
      `  Subscription: ${report.counts.schema.Subscription} (schema=md=runtime=${report.expected.Subscription})`,
      "  Reachability: Query→graphql_query; Mutation→graphql_mutation (logTelemetry/setNuxSeen unsupported); Subscription→graphql_subscribe",
    ].join("\n");
  }
  const issueLines = report.issues
    .map((i) => `  [${i.code}] ${i.message}`)
    .sort();
  return ["schema:check FAILED", ...issueLines].join("\n");
}
