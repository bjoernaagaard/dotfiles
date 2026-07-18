import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { withFileMutationQueue, type ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { describe, expect, it, vi } from "vite-plus/test";

vi.mock("node:child_process", () => ({
  spawnSync: vi.fn(() => ({ status: 1 })),
}));

import { runDiagramRender } from "../src/diagram/render";
import { registerPreview } from "../src/preview/index";

function capturePreviewTool() {
  const tools: any[] = [];
  const api = {
    registerTool: (tool: any) => tools.push(tool),
    registerCommand: () => {},
  } as unknown as ExtensionAPI;
  registerPreview(api);
  return tools.find((tool) => tool.name === "preview_content");
}

describe("cross-tool output locking", () => {
  it("queues preview_content and render_diagram behind the same absolute target lock", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "parseview-cross-tool-lock-"));
    const target = join(cwd, "shared", "artifact.html");
    let releaseLock!: () => void;
    let reportLocked!: () => void;
    const locked = new Promise<void>((resolve) => {
      reportLocked = resolve;
    });
    const release = new Promise<void>((resolve) => {
      releaseLock = resolve;
    });
    const holder = withFileMutationQueue(target, async () => {
      reportLocked();
      await release;
    });
    await locked;

    let completions = 0;
    const previewPromise = capturePreviewTool()
      .execute(
        "preview",
        { content: "# Preview", format: "browser", outputPath: target },
        undefined,
        undefined,
        { cwd },
      )
      .then((result: any) => {
        completions += 1;
        return result;
      });
    const diagramPromise = runDiagramRender("graph TD\nA-->B", "html", target, cwd).then(
      (result) => {
        completions += 1;
        return result;
      },
    );

    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(completions).toBe(0);
    releaseLock();
    await holder;

    const [preview, diagram] = await Promise.all([previewPromise, diagramPromise]);
    expect(preview.details.path).toBe(target);
    expect(diagram.details.path).toBe(target);
    const final = await readFile(target, "utf8");
    expect(final).toMatch(/^<!DOCTYPE html>/);
    expect(final.includes("<h1")).not.toBe(final.includes("<svg"));
  });
});
