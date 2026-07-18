import { mkdtemp, readFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, it, expect, vi, afterEach } from "vite-plus/test";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

vi.mock("beautiful-mermaid", async (importOriginal) => {
  const original = await importOriginal<typeof import("beautiful-mermaid")>();
  return {
    ...original,
    renderMermaidASCII: vi.fn(),
    renderMermaidSVG: vi.fn(),
  };
});

import { registerDiagram } from "../src/diagram/index";
import { registerMermaid } from "../src/mermaid/index";
import * as mermaid from "beautiful-mermaid";

function captureDiagramTool(name = "render_diagram") {
  const tools: any[] = [];
  const api = {
    registerTool: (tool: any) => tools.push(tool),
    registerCommand: () => {},
    on: () => {},
    registerShortcut: () => {},
  } as unknown as ExtensionAPI;

  registerDiagram(api);
  registerMermaid(api);
  const tool = tools.find((entry) => entry.name === name);
  if (!tool) throw new Error(`${name} tool not registered`);
  return tool;
}

describe("render_diagram hard failures", () => {
  const ascii = mermaid.renderMermaidASCII as any;
  const svg = mermaid.renderMermaidSVG as any;

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("throws when both ASCII and fallback renderers fail", async () => {
    ascii.mockImplementation(() => {
      throw new Error("ascii failed");
    });
    svg.mockImplementation(() => {
      throw new Error("svg failed");
    });

    const tool = captureDiagramTool();
    await expect(
      tool.execute(
        "call-1",
        { code: "graph TD\nA-->B", format: "ascii", outputPath: undefined },
        undefined,
        undefined,
        { cwd: "/tmp" },
      ),
    ).rejects.toThrow(/Diagram render failed/);
  });

  it("writes explicit output paths, including nested ASCII fallback targets", async () => {
    ascii.mockImplementation(() => {
      throw new Error("ascii failed");
    });
    svg.mockImplementation(() => "<svg>same-renderer</svg>");
    const root = await mkdtemp(join(tmpdir(), "parseview-diagram-"));
    const outputPath = join(root, "nested", "diagram.svg");

    const tool = captureDiagramTool();
    const result = await tool.execute(
      "call-path",
      { code: "graph TD\nA-->B", format: "ascii", outputPath },
      undefined,
      undefined,
      { cwd: root },
    );
    expect(await readFile(outputPath, "utf8")).toBe("<svg>same-renderer</svg>");
    expect(result.details.path).toBe(outputPath);
  });

  it("keeps mermaid as metadata-free compatibility delegate defaulting to ASCII", async () => {
    ascii.mockImplementation(() => "A -> B");
    svg.mockImplementation(() => "<svg/>");
    const alias = captureDiagramTool("mermaid");
    expect(alias.promptSnippet).toBeUndefined();
    expect(alias.promptGuidelines).toBeUndefined();

    const result = await alias.execute(
      "legacy-call",
      { code: "graph TD\nA-->B" },
      undefined,
      undefined,
      { cwd: "/tmp" },
    );
    expect(result.details).toEqual({ format: "ascii", truncated: false });
    expect(result.content[0].text).toBe("A -> B");
  });

  it("annotates truncated ASCII output", async () => {
    ascii.mockImplementation(() => "x".repeat(200_000));
    svg.mockImplementation(() => "<svg/>");

    const tool = captureDiagramTool();
    const result = await tool.execute(
      "call-2",
      { code: "graph TD\nA-->B", format: "ascii", outputPath: undefined },
      undefined,
      undefined,
      { cwd: "/tmp" },
    );

    expect(result.content[0].type).toBe("text");
    const text = result.content[0].text as string;
    expect(text).toContain("Output truncated");
    expect(result.details?.truncated).toBe(true);
    expect(result.details?.path).toMatch(/\.txt$/);
  });
});
