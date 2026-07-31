import { describe, it, expect } from "vite-plus/test";
import { ParseToolParameters } from "../../src/document/tools/parse";
import { QueryToolParameters } from "../../src/document/tools/query";

type TypeboxNode = Record<string, unknown>;

function findEnum(node: any): string[] | undefined {
  if (!node || typeof node !== "object") return undefined;
  if (typeof node.type === "string" && node.type === "string" && Array.isArray(node.enum)) {
    return node.enum;
  }
  for (const key of ["oneOf", "anyOf", "allOf"]) {
    const entries = node[key];
    if (Array.isArray(entries)) {
      for (const entry of entries) {
        const candidate = findEnum(entry);
        if (candidate) return candidate;
      }
    }
  }
  return undefined;
}

describe("tool schemas use string enums", () => {
  it("parse schema is strict, modern-only, and uses string enums", () => {
    const parse: TypeboxNode = ParseToolParameters as unknown as TypeboxNode;
    const properties = parse.properties as Record<string, unknown>;
    expect(Object.keys(properties)).toEqual(
      expect.arrayContaining([
        "path",
        "format",
        "ocrMode",
        "ocrLanguage",
        "targetPages",
        "maxPages",
        "dpi",
        "imageMode",
        "extractLinks",
        "preserveVerySmallText",
        "emitWordBoxes",
        "skipDiagonalText",
        "includeComplexity",
        "cropBox",
        "force",
      ]),
    );
    expect(properties).not.toHaveProperty("pages");
    expect(properties).not.toHaveProperty("useOcr");
    expect(parse.additionalProperties).toBe(false);
    expect(findEnum(properties.format)).toEqual(["text", "markdown", "json"]);
    expect(findEnum(properties.ocrMode)).toEqual(["auto", "on", "off"]);
    expect(findEnum(properties.imageMode)).toEqual(["off", "placeholder", "embed"]);
  });

  it("query schema uses string enum for action", () => {
    const query: TypeboxNode = QueryToolParameters as unknown as TypeboxNode;
    const properties = query.properties as Record<string, unknown>;
    expect(findEnum(properties.action)).toEqual(["read", "search"]);
  });
});
