import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, it, vi, afterEach } from "vite-plus/test";
import { CONFIG_DIR_NAME, type ExtensionAPI } from "@earendil-works/pi-coding-agent";

vi.mock("node:child_process", () => ({
  spawnSync: vi.fn(() => ({ status: 1 })),
}));
vi.mock("../src/preview/export", () => ({
  exportToPng: vi.fn(async (html: string, outputPath: string) => {
    await writeFile(outputPath, `PNG:${html}`, "utf8");
    return outputPath;
  }),
  exportToPdf: vi.fn(async (html: string, outputPath: string) => {
    await writeFile(outputPath, `PDF:${html}`, "utf8");
    return outputPath;
  }),
}));

import { parsePreviewCommandArgs, registerPreview } from "../src/preview/index";
import { exportToPdf } from "../src/preview/export";
import { initConfig, resetConfig } from "../src/config";

function capturePreviewTool() {
  const tools: any[] = [];
  const commands = new Map<string, any>();
  const api = {
    registerTool: (tool: any) => tools.push(tool),
    registerCommand: (name: string, command: any) => commands.set(name, command.handler),
    on: () => {},
  } as unknown as ExtensionAPI;

  registerPreview(api);
  const tool = tools.find((entry) => entry.name === "preview_content");
  if (!tool) throw new Error("preview_content tool not registered");
  return { tool, commands };
}

function root() {
  return join(tmpdir(), `parseview-preview-${process.pid}-${Date.now()}-${Math.random()}`);
}

describe("preview_content tool contracts", () => {
  afterEach(() => resetConfig());

  it("throws on empty content", async () => {
    const { tool } = capturePreviewTool();
    await expect(
      tool.execute("call", { format: "browser", fontSizePx: 16 }, undefined, undefined, {
        cwd: "/tmp",
      }),
    ).rejects.toThrow("No content to render");
  });

  it.each([
    ["browser", "preview.html", "<!DOCTYPE html>"],
    ["pdf", "preview.pdf", "PDF:"],
    ["terminal", "preview.png", "PNG:"],
  ])("writes a nested explicit %s output to an absolute path", async (format, filename, marker) => {
    const cwd = root();
    const outputPath = join("nested", filename);
    const result = await capturePreviewTool().tool.execute(
      "call",
      { content: "# Hello", format, outputPath },
      undefined,
      undefined,
      { cwd },
    );

    expect(result.details.path).toBe(join(cwd, outputPath));
    expect(await readFile(result.details.path, "utf8")).toContain(marker);
  });

  it("serializes the complete mutation window for concurrent writes to one outputPath", async () => {
    let active = 0;
    let maximum = 0;
    (exportToPdf as any).mockImplementation(async (html: string, outputPath: string) => {
      active += 1;
      maximum = Math.max(maximum, active);
      await new Promise((resolve) => setTimeout(resolve, 15));
      await writeFile(outputPath, `PDF:${html}`, "utf8");
      active -= 1;
      return outputPath;
    });

    const { tool } = capturePreviewTool();
    const cwd = root();
    const params = { content: "same", format: "pdf", outputPath: "same/output.pdf" };
    await Promise.all([
      tool.execute("one", params, undefined, undefined, { cwd }),
      tool.execute("two", params, undefined, undefined, { cwd }),
    ]);
    expect(maximum).toBe(1);
  });

  it("uses configured format and font size when tool arguments omit them", async () => {
    const cwd = root();
    await mkdir(join(cwd, CONFIG_DIR_NAME), { recursive: true });
    await writeFile(
      join(cwd, CONFIG_DIR_NAME, "settings.json"),
      JSON.stringify({ "pi-parseview": { defaultFormat: "browser", fontSize: 21 } }),
    );
    initConfig(cwd, join(cwd, "agent"));

    const result = await capturePreviewTool().tool.execute(
      "configured",
      { content: "# Configured", outputPath: "configured.html" },
      undefined,
      undefined,
      { cwd },
    );
    expect(result.details.format).toBe("html");
    expect(await readFile(result.details.path, "utf8")).toContain("font-size: 21px");
  });

  it("uses configured defaults in the preview command", async () => {
    const cwd = root();
    await mkdir(join(cwd, CONFIG_DIR_NAME), { recursive: true });
    await writeFile(
      join(cwd, CONFIG_DIR_NAME, "settings.json"),
      JSON.stringify({ "pi-parseview": { defaultFormat: "pdf", fontSize: 19 } }),
    );
    initConfig(cwd, join(cwd, "agent"));

    const { commands } = capturePreviewTool();
    const notify = vi.fn();
    await commands.get("preview")("# Configured", {
      cwd,
      hasUI: true,
      ui: { notify },
    });
    expect(notify).toHaveBeenCalledWith(expect.stringMatching(/^PDF saved:/), "info");
    expect(exportToPdf).toHaveBeenCalled();
    const html = (exportToPdf as any).mock.calls.at(-1)?.[0] as string;
    expect(html).toContain("font-size: 19px");
  });

  it("loads quoted file paths with spaces in every preview command", async () => {
    const cwd = root();
    const relativePath = join("docs", "project notes.md");
    await mkdir(join(cwd, "docs"), { recursive: true });
    await writeFile(join(cwd, relativePath), "# Content from file", "utf8");

    const { commands } = capturePreviewTool();
    for (const [name, args] of [
      ["preview", `--browser "${relativePath}"`],
      ["preview-browser", `"${relativePath}"`],
      ["preview-pdf", `"${relativePath}"`],
    ] as const) {
      const notify = vi.fn();
      await commands.get(name)(args, { cwd, hasUI: true, ui: { notify } });
      const message = notify.mock.calls.at(-1)?.[0] as string;
      const outputPath = message.slice(message.indexOf(": ") + 2);
      expect(await readFile(outputPath, "utf8")).toContain("Content from file");
    }
  });

  it("parses preview flags regardless of their position", () => {
    expect(parsePreviewCommandArgs('--browser "docs/project notes.md" --font-size 20')).toEqual({
      content: "docs/project notes.md",
      useBrowser: true,
      usePdf: false,
      fontSize: 20,
    });
  });

  it("renders thrown errors as failures", () => {
    const { tool } = capturePreviewTool();
    const theme = { fg: (_color: string, text: string) => text };
    const rendered = tool
      .renderResult(
        { content: [{ type: "text", text: "preview broke" }], details: {} },
        { expanded: false, isPartial: false },
        theme,
        { isError: true },
      )
      .render(120)
      .join("\n")
      .trimEnd();
    expect(rendered).toBe("preview error: preview broke");
  });
});
