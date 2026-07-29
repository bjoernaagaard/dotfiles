import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { buildSchema, parse, validate } from "graphql";
import * as documents from "../src/clients/documents/diagnose.gql.ts";

describe("diagnosis GraphQL documents", () => {
  it("all operations validate against the vendored Dagster schema", () => {
    const schema = buildSchema(readFileSync("sources/dagster-oss/graphql/schema.graphql", "utf8"));
    for (const [name, document] of Object.entries(documents)) {
      if (typeof document !== "string") continue;
      expect(validate(schema, parse(document)), name).toEqual([]);
    }
  });
});
