import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vite-plus/test";
import { CONFIG_DIR_NAME, type ExtensionAPI } from "@earendil-works/pi-coding-agent";
import parseviewExtension from "../index";
import { isBrowserAvailable, setBrowserAvailable } from "../src/browser";
import { initConfig, loadConfig, resetConfig } from "../src/config";
import { isLiteparseAvailable, setLiteparseAvailable } from "../src/parser/parse-core";

function createApiRecorder() {
  const tools: any[] = [];
  const commands: string[] = [];
  const handlers = new Map<string, (...args: any[]) => any>();
  let active = ["read", "other_extension_tool"];
  const transitions: string[][] = [];

  const api = {
    registerTool: (tool: any) => {
      tools.push(tool);
      active.push(tool.name);
    },
    registerCommand: (name: string, command: any) => {
      commands.push(name);
      handlers.set(`command:${name}`, command.handler);
    },
    on: (event: string, handler: (...args: any[]) => any) => handlers.set(event, handler),
    getActiveTools: () => [...active],
    getAllTools: () => [
      { name: "read", sourceInfo: { source: "builtin", path: "<builtin:read>" } },
      {
        name: "other_extension_tool",
        sourceInfo: { source: "other", path: "/tmp/other/index.ts" },
      },
      ...tools.map((tool) => ({
        ...tool,
        sourceInfo: { source: "@juvio15/pi-parseview", path: "/tmp/pi-parseview/index.ts" },
      })),
    ],
    setActiveTools: (names: string[]) => {
      active = [...new Set(names)];
      transitions.push([...active]);
    },
  } as unknown as ExtensionAPI;

  return { api, tools, commands, handlers, transitions, active: () => active };
}

const TOOL_NAMES = [
  "parse_document",
  "query_document",
  "screenshot_document",
  "render_diagram",
  "mermaid",
  "preview_content",
];
const COMMAND_NAMES = [
  "parse",
  "parseview-doctor",
  "parseview-cache",
  "diagram",
  "preview",
  "preview-browser",
  "preview-pdf",
];

describe("extension registration", () => {
  it("registers the complete public surface through the real factory", () => {
    const state = createApiRecorder();
    parseviewExtension(state.api);

    expect(state.tools.map((tool) => tool.name).sort()).toEqual([...TOOL_NAMES].sort());
    expect([...state.commands].sort()).toEqual([...COMMAND_NAMES].sort());
    expect(state.handlers.has("session_start")).toBe(true);
    expect(state.handlers.has("session_shutdown")).toBe(true);
    expect(state.handlers.has("agent_settled")).toBe(true);
    expect(state.handlers.has("agent_end")).toBe(false);
    expect(state.handlers.has(["resources", "discover"].join("_"))).toBe(false);
  });

  it("keeps the compatibility alias metadata-free and all lazy tools free of active prompt metadata", () => {
    const state = createApiRecorder();
    parseviewExtension(state.api);
    for (const tool of state.tools) {
      expect(tool.promptSnippet).toBeUndefined();
      expect(tool.promptGuidelines).toBeUndefined();
    }
    expect(state.tools.find((tool) => tool.name === "mermaid")?.description).toContain(
      "Compatibility alias",
    );
  });

  it("exposes the document workflow in descriptions instead of resource metadata", () => {
    const state = createApiRecorder();
    parseviewExtension(state.api);
    expect(state.tools.find((tool) => tool.name === "parse_document")?.description).toMatch(
      /local regular file|Parse once|documentId|OCR/i,
    );
    expect(state.tools.find((tool) => tool.name === "query_document")?.description).toMatch(
      /Search to locate|smallest useful|continuation|recovery/i,
    );
    expect(state.tools.find((tool) => tool.name === "screenshot_document")?.description).toMatch(
      /smallest useful|150 DPI|bounded/i,
    );
  });

  it("reconstructs extension-local registrations for a fresh reload instance", () => {
    const first = createApiRecorder();
    const second = createApiRecorder();
    parseviewExtension(first.api);
    parseviewExtension(second.api);
    expect(second.tools.map((tool) => tool.name)).toEqual(first.tools.map((tool) => tool.name));
    expect(second.commands).toEqual(first.commands);
  });
});

describe("startup validation", () => {
  it("runs complete session initialization and reset behavior on every session_start", async () => {
    resetConfig();
    const cwd = await mkdtemp(join(tmpdir(), "parseview-session-start-"));
    const projectConfigDir = join(cwd, CONFIG_DIR_NAME);
    await mkdir(projectConfigDir, { recursive: true });
    await writeFile(
      join(projectConfigDir, "settings.json"),
      JSON.stringify({ "pi-parseview": { fontSize: 23 } }),
    );

    const state = createApiRecorder();
    parseviewExtension(state.api);
    const notify = vi.fn();
    const context = { cwd, hasUI: true, ui: { notify } } as any;
    const sessionStart = state.handlers.get("session_start")!;

    await sessionStart({ reason: "startup" }, context);
    expect(loadConfig().fontSize).toBe(23);
    expect(state.active()).not.toEqual(
      expect.arrayContaining(["parse_document", "render_diagram", "preview_content"]),
    );

    await state.handlers.get("input")?.({ text: "draw a sequence diagram" }, context);
    expect(state.active()).toContain("render_diagram");
    await sessionStart({ reason: "reload" }, context);
    expect(state.active()).not.toContain("render_diagram");

    const warningCountPerCall = Number(!isLiteparseAvailable()) + Number(!isBrowserAvailable());
    expect(notify).toHaveBeenCalledTimes(warningCountPerCall * 2);
    if (!isLiteparseAvailable()) {
      expect(notify.mock.calls.filter(([message]) => /LiteParse/.test(message))).toHaveLength(2);
    }
    if (!isBrowserAvailable()) {
      expect(notify.mock.calls.filter(([message]) => /Chromium/.test(message))).toHaveLength(2);
    }
    resetConfig();
  });

  it("config is initialized after initConfig call", () => {
    resetConfig();
    const cwd = process.cwd();
    const agentDir = `${homedir()}/${CONFIG_DIR_NAME}/agent`;
    initConfig(cwd, agentDir);
    const cfg = loadConfig();
    expect(typeof cfg.fontSize).toBe("number");
    resetConfig();
  });

  it("browser and liteparse availability flags are independent", () => {
    setBrowserAvailable(false);
    setLiteparseAvailable(true);
    expect(isBrowserAvailable()).toBe(false);
    expect(isLiteparseAvailable()).toBe(true);

    setBrowserAvailable(true);
    setLiteparseAvailable(false);
    expect(isBrowserAvailable()).toBe(true);
    expect(isLiteparseAvailable()).toBe(false);

    setBrowserAvailable(true);
    setLiteparseAvailable(true);
  });
});
