import { describe, expect, it, vi } from "vite-plus/test";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { buildGuidelines, matchKeywords, registerAutotrigger } from "../src/autotrigger/index";
import type { ActivationController } from "../src/tools/activation";

const noMatch = { matched: false, keywords: [], category: "" };

describe("matchKeywords", () => {
  it.each([
    "draw a sequence diagram of login",
    "visualize the data flow",
    "show the architecture as a diagram",
    "map the service relationships",
    "render this Mermaid diagram: graph TD\nA-->B",
    "draw a sequence diagram: sequenceDiagram\nA->>B: hello",
    "render this Mermaid code: stateDiagram-v2\n[*] --> Ready",
  ])("matches explicit diagram intent: %s", (text) => {
    expect(matchKeywords(text)).toMatchObject({ matched: true, category: "diagram" });
  });

  it.each([
    "render this markdown",
    "preview this file as HTML",
    "open the report as a PDF",
    "render this LaTeX",
    "render this code",
  ])("matches explicit preview intent: %s", (text) => {
    expect(matchKeywords(text)).toMatchObject({ matched: true, category: "preview" });
  });

  it.each([
    ["parse this document", "document.parse"],
    ["OCR this PDF", "document.parse"],
    ["search the cached document", "document.query"],
    [`read documentId ${"a".repeat(24)}`, "document.query"],
    ["screenshot page 3", "document.screenshot"],
    ["inspect the page layout", "document.screenshot"],
  ])("routes document intent: %s", (text, category) => {
    expect(matchKeywords(text)).toMatchObject({ matched: true, category });
  });

  it.each([
    "review the architecture for security issues",
    "fix the deployment pipeline",
    "update the database schema",
    "sort events on the timeline",
    "query the graph database",
    "show me the failing test",
    "display the current configuration",
    "format this JSON inline",
    "preview the planned code changes in your answer",
    "render deploy completed successfully",
    "The documentation calls this a diagram.",
    "The renderer uses the words render, preview, PDF, page, layout, and graph.",
    'Explain why the requirement says "draw a sequence diagram".',
    "Review this code without rendering it: `graph TD; A-->B`.",
    "Review this fenced example:\n```mermaid\ngraph TD\nA-->B\n```",
  ])("does not match non-rendering intent: %s", (text) => {
    expect(matchKeywords(text)).toEqual(noMatch);
  });
});

describe("buildGuidelines", () => {
  it("advertises only the canonical diagram tool", () => {
    const result = buildGuidelines(["sequence diagram"], "diagram");
    expect(result).toContain("render_diagram");
    expect(result).not.toMatch(/`mermaid`/);
  });

  it("returns focused preview and document guidance", () => {
    expect(buildGuidelines(["render this markdown"], "preview")).toMatch(
      /preview_content|Chromium|artifact path/,
    );
    expect(buildGuidelines(["parse document"], "document.parse")).toMatch(
      /parse_document|OCR|documentId/,
    );
    expect(buildGuidelines(["query document"], "document.query")).toMatch(
      /search|smallest|continuation/,
    );
    expect(buildGuidelines(["screenshot document"], "document.screenshot")).toMatch(
      /smallest|150 DPI|manifest/,
    );
    expect(buildGuidelines([], "")).toBe("");
  });
});

function captureAutotrigger() {
  const handlers = new Map<string, (...args: any[]) => any>();
  const beginTurn = vi.fn(() => ["render_diagram"]);
  const activation = { beginTurn } as unknown as ActivationController;
  const api = {
    on: (event: string, handler: (...args: any[]) => any) => handlers.set(event, handler),
    getActiveTools: () => [],
  } as unknown as ExtensionAPI;
  registerAutotrigger(api, activation);
  return { handlers, beginTurn };
}

describe("autotrigger event behavior", () => {
  it("activates the canonical capability and injects only a temporary system prompt", async () => {
    const { handlers, beginTurn } = captureAutotrigger();
    await handlers.get("input")?.({ text: "draw a sequence diagram" }, {});
    const result = await handlers.get("before_agent_start")?.({ systemPrompt: "base" }, {});

    expect(beginTurn).toHaveBeenCalledWith(["render_diagram"]);
    expect(result.systemPrompt).toMatch(/^base/);
    expect(result.systemPrompt).toContain("render_diagram");
    expect(result).not.toHaveProperty("message");
    expect(JSON.stringify(result)).not.toContain('"role":"user"');
    expect(handlers.has("context")).toBe(false);
  });

  it("injects at most once per input and resets for the next input", async () => {
    const { handlers } = captureAutotrigger();
    await handlers.get("input")?.({ text: "render this markdown" }, {});
    expect(await handlers.get("before_agent_start")?.({ systemPrompt: "base" }, {})).toBeDefined();
    expect(
      await handlers.get("before_agent_start")?.({ systemPrompt: "base" }, {}),
    ).toBeUndefined();

    await handlers.get("input")?.({ text: "render this markdown" }, {});
    expect(await handlers.get("before_agent_start")?.({ systemPrompt: "base" }, {})).toBeDefined();
  });

  it.each(["tui", "rpc", "json", "print"])(
    "routes activation independently of %s mode",
    async (mode) => {
      const { handlers, beginTurn } = captureAutotrigger();
      await handlers.get("input")?.({ text: "render this markdown" }, { mode, hasUI: false });
      expect(beginTurn).toHaveBeenCalledWith(["preview_content"]);
    },
  );

  it("does not alter activation or prompts for nonmatching input", async () => {
    const { handlers, beginTurn } = captureAutotrigger();
    await handlers.get("input")?.({ text: "fix the deployment pipeline" }, {});
    expect(beginTurn).toHaveBeenCalledWith([]);
    expect(
      await handlers.get("before_agent_start")?.({ systemPrompt: "base" }, {}),
    ).toBeUndefined();
  });
});
