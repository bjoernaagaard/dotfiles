import { readFile } from "node:fs/promises";
import { describe, expect, it, vi } from "vite-plus/test";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

vi.mock("node:child_process", () => ({
  spawnSync: vi.fn(() => ({ status: 1 })),
}));
vi.mock("../src/document/native", async (importOriginal) => {
  const original = await importOriginal<typeof import("../src/document/native")>();
  return {
    ...original,
    loadNativeAdapter: vi.fn(async () => {
      throw new Error("mock native load failure");
    }),
  };
});
vi.mock("../src/browser", async (importOriginal) => {
  const original = await importOriginal<typeof import("../src/browser")>();
  return {
    ...original,
    findChromiumExecutable: vi.fn(() => undefined),
    closeBrowser: vi.fn(async () => undefined),
  };
});

import parseviewExtension from "../index";
import { isBrowserAvailable } from "../src/browser";
import { isLiteparseAvailable } from "../src/parser/parse-core";

function recorder() {
  const tools: any[] = [];
  const handlers = new Map<string, (...args: any[]) => any>();
  let active = ["read", "other_extension_tool"];
  const api = {
    registerTool: (tool: any) => {
      tools.push(tool);
      active.push(tool.name);
    },
    registerCommand: () => {},
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
    },
  } as unknown as ExtensionAPI;
  return { api, tools, handlers, active: () => active };
}

describe("startup dependency degradation", () => {
  it("disables native/browser capabilities independently and keeps HTML preview usable", async () => {
    const state = recorder();
    parseviewExtension(state.api);
    const notify = vi.fn();
    const uiContext = { cwd: process.cwd(), hasUI: true, ui: { notify } } as any;

    await state.handlers.get("session_start")?.({ reason: "startup" }, uiContext);

    expect(isLiteparseAvailable()).toBe(false);
    expect(isBrowserAvailable()).toBe(false);
    expect(state.active()).toEqual(["read", "other_extension_tool"]);
    expect(notify).toHaveBeenCalledTimes(2);
    expect(notify.mock.calls.map(([message]) => message)).toEqual([
      expect.stringMatching(/LiteParse/),
      expect.stringMatching(/PNG\/PDF.*HTML\/browser/),
    ]);

    await state.handlers.get("session_start")?.({ reason: "reload" }, uiContext);
    expect(notify).toHaveBeenCalledTimes(4);
    expect(notify.mock.calls.filter(([message]) => /LiteParse/.test(message))).toHaveLength(2);
    expect(notify.mock.calls.filter(([message]) => /Chromium/.test(message))).toHaveLength(2);

    await state.handlers.get("input")?.({ text: "parse this document" }, uiContext);
    expect(state.active()).toContain("parse_document");
    await state.handlers.get("input")?.({ text: "search the cached document" }, uiContext);
    expect(state.active()).toContain("query_document");
    await state.handlers.get("input")?.({ text: "screenshot page 1" }, uiContext);
    expect(state.active()).not.toContain("screenshot_document");
    await state.handlers.get("input")?.({ text: "draw a sequence diagram" }, uiContext);
    expect(state.active()).toContain("render_diagram");
    await state.handlers.get("input")?.({ text: "render this markdown" }, uiContext);
    expect(state.active()).toContain("preview_content");

    const preview = state.tools.find((tool) => tool.name === "preview_content");
    const result = await preview.execute(
      "html-preview",
      { content: "# Works without Chromium", format: "browser" },
      undefined,
      undefined,
      { cwd: process.cwd() },
    );
    expect(result.details).toMatchObject({ format: "html", opened: false });
    expect(await readFile(result.details.path, "utf8")).toContain("Works without Chromium");

    await expect(
      state.handlers.get("session_start")?.({ reason: "reload" }, {
        cwd: process.cwd(),
        hasUI: false,
        ui: { notify },
      } as any),
    ).resolves.toBeUndefined();
    expect(notify).toHaveBeenCalledTimes(4);
  });
});
