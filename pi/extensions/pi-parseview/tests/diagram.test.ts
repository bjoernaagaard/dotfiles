import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, it, expect, vi, afterEach } from "vite-plus/test";
import { CONFIG_DIR_NAME, type ExtensionAPI } from "@earendil-works/pi-coding-agent";

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
import { initConfig, resetConfig } from "../src/config";
import * as mermaid from "beautiful-mermaid";

function captureDiagramTool(name = "render_diagram") {
  const tools: any[] = [];
  const commands = new Map<string, any>();
  const api = {
    registerTool: (tool: any) => tools.push(tool),
    registerCommand: (commandName: string, command: any) =>
      commands.set(commandName, command.handler),
    on: () => {},
    registerShortcut: () => {},
  } as unknown as ExtensionAPI;

  registerDiagram(api);
  registerMermaid(api);
  const tool = tools.find((entry) => entry.name === name);
  if (!tool) throw new Error(`${name} tool not registered`);
  return { tool, commands };
}

describe("render_diagram hard failures", () => {
  const ascii = mermaid.renderMermaidASCII as any;
  const svg = mermaid.renderMermaidSVG as any;

  afterEach(() => {
    vi.restoreAllMocks();
    resetConfig();
  });

  it("throws when both ASCII and fallback renderers fail", async () => {
    ascii.mockImplementation(() => {
      throw new Error("ascii failed");
    });
    svg.mockImplementation(() => {
      throw new Error("svg failed");
    });

    const { tool } = captureDiagramTool();
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

    const { tool } = captureDiagramTool();
    const result = await tool.execute(
      "call-path",
      { code: "graph TD\nA-->B", format: "ascii", outputPath },
      undefined,
      undefined,
      { cwd: root },
    );
    const saved = await readFile(outputPath, "utf8");
    expect(saved).toContain('role="img"');
    expect(saved).toContain("same-renderer");
    expect(result.details.path).toBe(outputPath);
  });

  it("keeps mermaid as metadata-free compatibility delegate defaulting to ASCII", async () => {
    ascii.mockImplementation(() => "A -> B");
    svg.mockImplementation(() => "<svg/>");
    const { tool: alias } = captureDiagramTool("mermaid");
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

    const { tool } = captureDiagramTool();
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

  it("uses the configured diagram format for tools and commands", async () => {
    const root = await mkdtemp(join(tmpdir(), "parseview-diagram-default-"));
    await mkdir(join(root, CONFIG_DIR_NAME), { recursive: true });
    await writeFile(
      join(root, CONFIG_DIR_NAME, "settings.json"),
      JSON.stringify({
        "pi-parseview": { diagramDefaultFormat: "svg", diagramTheme: "nord-light" },
      }),
    );
    initConfig(root, join(root, "agent"));
    vi.mocked(svg).mockImplementation(() => "<svg configured />");
    const { tool, commands } = captureDiagramTool();

    const result = await tool.execute(
      "configured-tool",
      { code: "graph TD\nA-->B" },
      undefined,
      undefined,
      { cwd: root },
    );
    expect(result.details.format).toBe("svg");
    expect(svg).toHaveBeenCalledWith(
      "graph TD\nA-->B",
      expect.objectContaining({ bg: "#eceff4", fg: "#2e3440" }),
    );

    const notify = vi.fn();
    await commands.get("diagram")("graph TD\nA-->B", {
      cwd: root,
      hasUI: true,
      signal: undefined,
      ui: { notify },
    });
    expect(notify).toHaveBeenCalledWith(expect.stringContaining("Diagram saved as SVG"), "info");
  });

  it("renders thrown errors as failures", () => {
    const { tool } = captureDiagramTool();
    const theme = { fg: (_color: string, text: string) => text, bold: (text: string) => text };
    const rendered = tool
      .renderResult(
        { content: [{ type: "text", text: "diagram broke" }], details: {} },
        { expanded: false, isPartial: false },
        theme,
        { isError: true },
      )
      .render(120)
      .join("\n")
      .trimEnd();
    expect(rendered).toBe("diagram error: diagram broke");

    const { tool: alias } = captureDiagramTool("mermaid");
    const aliasRendered = alias
      .renderResult(
        { content: [{ type: "text", text: "alias broke" }], details: {} },
        { expanded: false, isPartial: false },
        theme,
        { isError: true },
      )
      .render(120)
      .join("\n")
      .trimEnd();
    expect(aliasRendered).toBe("mermaid error: alias broke");
  });

  it("passes the active Pi theme to Beautiful Mermaid", async () => {
    svg.mockClear();
    svg.mockImplementation(() => "<svg>themed</svg>");
    const { tool } = captureDiagramTool();

    await tool.execute(
      "themed-call",
      { code: "graph TD\nA-->B", format: "svg", outputPath: undefined },
      undefined,
      undefined,
      { cwd: "/tmp", ui: { theme: { name: "nord-light" } } },
    );

    expect(svg).toHaveBeenCalledWith(
      "graph TD\nA-->B",
      expect.objectContaining({ bg: "#eceff4", fg: "#2e3440" }),
    );
  });

  it("rejects unsupported diagram headers before invoking Beautiful Mermaid", async () => {
    svg.mockClear();
    const { tool } = captureDiagramTool();

    await expect(
      tool.execute(
        "unsupported-call",
        { code: "gantt\ntitle Work", format: "svg", outputPath: undefined },
        undefined,
        undefined,
        { cwd: "/tmp" },
      ),
    ).rejects.toThrow(/Unsupported Mermaid diagram header/);
    expect(svg).not.toHaveBeenCalled();
  });
});
