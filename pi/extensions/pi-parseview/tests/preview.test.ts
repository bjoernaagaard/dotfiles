import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, it, vi } from "vite-plus/test";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

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

import { registerPreview } from "../src/preview/index";
import { exportToPdf } from "../src/preview/export";

function capturePreviewTool() {
  const tools: any[] = [];
  const api = {
    registerTool: (tool: any) => tools.push(tool),
    registerCommand: () => {},
    on: () => {},
  } as unknown as ExtensionAPI;

  registerPreview(api);
  const tool = tools.find((entry) => entry.name === "preview_content");
  if (!tool) throw new Error("preview_content tool not registered");
  return tool;
}

function root() {
  return join(tmpdir(), `parseview-preview-${process.pid}-${Date.now()}-${Math.random()}`);
}

describe("preview_content tool contracts", () => {
  it("throws on empty content", async () => {
    const tool = capturePreviewTool();
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
    const result = await capturePreviewTool().execute(
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

    const tool = capturePreviewTool();
    const cwd = root();
    const params = { content: "same", format: "pdf", outputPath: "same/output.pdf" };
    await Promise.all([
      tool.execute("one", params, undefined, undefined, { cwd }),
      tool.execute("two", params, undefined, undefined, { cwd }),
    ]);
    expect(maximum).toBe(1);
  });
});
