import { Check } from "typebox/value";
import { describe, expect, it, vi } from "vite-plus/test";
import {
  createParseTool,
  ParseToolParameters,
  prepareParseArguments,
} from "../../src/document/tools/parse";
import type { DocumentService } from "../../src/document/parser";

function outcome(path: string) {
  return {
    documentId: "a".repeat(24),
    cacheHit: false,
    manifest: {
      pageCount: 1,
      source: { realPath: path },
      redactedConfig: { targetPages: undefined, format: "markdown" },
    },
    documentText: "hello",
    documentMarkdown: "hello",
    pages: [],
    textItems: [],
    preview: "hello",
    ocrModeRequested: "auto",
    ocrModeResolved: "off",
    artifactPaths: [],
  } as any;
}

function fakeTool() {
  const parse = vi.fn(async (input: any) => outcome(input.path));
  const service = { parse } as unknown as DocumentService;
  const onParsed = vi.fn();
  return { tool: createParseTool(service, { onParsed }), parse, onParsed };
}

describe("parse_document argument preparation", () => {
  it.each([
    ["@/tmp/sample.pdf", "/tmp/sample.pdf"],
    ["@fixtures/sample.pdf", "fixtures/sample.pdf"],
    ["fixtures/sample.pdf", "fixtures/sample.pdf"],
    ["@@fixtures/sample.pdf", "@fixtures/sample.pdf"],
  ])("normalizes exactly one leading @ from %s", async (inputPath, expected) => {
    const { tool, parse } = fakeTool();
    const prepared = tool.prepareArguments({ path: inputPath });
    await tool.execute("call", prepared as any, undefined, undefined, { cwd: "/work" });
    expect(parse).toHaveBeenCalledWith(
      expect.objectContaining({ path: expected, format: "markdown" }),
      expect.anything(),
      undefined,
      expect.any(Function),
    );
  });

  it("rejects a lone @ before reaching the service", async () => {
    const { tool, parse } = fakeTool();
    const prepared = tool.prepareArguments({ path: "@" });
    await expect(
      tool.execute("call", prepared as any, undefined, undefined, { cwd: "/work" }),
    ).rejects.toThrow("path is required");
    expect(parse).not.toHaveBeenCalled();
  });

  it("maps valid legacy fields, lets modern fields win, and preserves unknown keys", () => {
    expect(prepareParseArguments({ path: "doc.pdf", pages: "1-3", useOcr: true })).toEqual({
      path: "doc.pdf",
      targetPages: "1-3",
      ocrMode: "on",
    });
    expect(
      prepareParseArguments({
        path: "doc.pdf",
        pages: "1-3",
        targetPages: "4",
        useOcr: false,
        ocrMode: "auto",
        unknown: true,
      }),
    ).toEqual({
      path: "doc.pdf",
      targetPages: "4",
      ocrMode: "auto",
      unknown: true,
    });
  });

  it.each([
    { path: "doc.pdf", pages: 7 },
    { path: "doc.pdf", pages: [] },
    { path: "doc.pdf", pages: null, targetPages: "2" },
    { path: "doc.pdf", useOcr: "true" },
    { path: "doc.pdf", useOcr: 1, ocrMode: "auto" },
    { path: "doc.pdf", unknown: true },
  ])("preserves malformed legacy or unknown fields so strict validation rejects %#", (input) => {
    const prepared = prepareParseArguments(input);
    expect(Check(ParseToolParameters, prepared)).toBe(false);
  });

  it.each([null, [], "doc.pdf", 7])(
    "leaves non-object legacy argument shapes for deterministic schema rejection: %j",
    (input) => {
      const prepared = prepareParseArguments(input);
      expect(prepared).toBe(input);
      expect(Check(ParseToolParameters, prepared)).toBe(false);
    },
  );

  it("activates follow-up tools only after a successful parse", async () => {
    const success = fakeTool();
    await success.tool.execute("call", { path: "doc.pdf" }, undefined, undefined, {
      cwd: "/work",
    });
    expect(success.onParsed).toHaveBeenCalledOnce();

    const service = {
      parse: vi.fn(async () => {
        throw new Error("unavailable");
      }),
    } as unknown as DocumentService;
    const onParsed = vi.fn();
    const failed = createParseTool(service, { onParsed });
    await expect(
      failed.execute("call", { path: "doc.pdf" }, undefined, undefined, { cwd: "/work" }),
    ).rejects.toThrow("unavailable");
    expect(onParsed).not.toHaveBeenCalled();
  });
});
