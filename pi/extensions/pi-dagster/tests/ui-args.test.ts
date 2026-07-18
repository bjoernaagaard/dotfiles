import { describe, expect, it } from "vitest";
import { parseKvArgs } from "../src/modules/ui.ts";

describe("parseKvArgs", () => {
  it("parses key=value tokens", () => {
    expect(
      parseKvArgs(
        "name=local-dev graphqlHttp=http://localhost:3000/graphql policy=readOnly",
      ),
    ).toEqual({
      name: "local-dev",
      graphqlHttp: "http://localhost:3000/graphql",
      policy: "readOnly",
    });
  });

  it("supports quoted values", () => {
    expect(parseKvArgs(`projectRoot="/tmp/my project" name='x'`)).toEqual({
      projectRoot: "/tmp/my project",
      name: "x",
    });
  });
});
