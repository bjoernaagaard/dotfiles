import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import {
  withFileMutationQueue,
  type ExtensionAPI,
  type ExtensionCommandContext,
} from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { StringEnum } from "@earendil-works/pi-ai";
import { Text } from "@earendil-works/pi-tui";
import { loadConfig } from "../config";
import { resolvePath, writeTempFile } from "../utils";
import { renderMarkdown, wrapWithTheme } from "./render";
import { exportToPng, exportToPdf } from "./export";

const DEFAULT_BG = "#1e1e2e";
const DEFAULT_FG = "#cdd6f4";

function openWithBrowser(filePath: string): boolean {
  const [command, args] =
    process.platform === "darwin"
      ? ["open", [filePath]]
      : process.platform === "win32"
        ? ["explorer.exe", [filePath]]
        : ["xdg-open", [filePath]];
  const result = spawnSync(command, args, { timeout: 3000, stdio: "ignore" });
  return !result.error && result.status === 0;
}

async function mutateSelectedOutput(
  filePath: string,
  cwd: string,
  mutation: (absolutePath: string) => Promise<void>,
): Promise<string> {
  const target = resolvePath(filePath, cwd);
  await withFileMutationQueue(target, async () => {
    await mkdir(dirname(target), { recursive: true });
    await mutation(target);
  });
  return target;
}

function guardAbort(signal?: AbortSignal | null): void {
  if (signal?.aborted) {
    throw new Error("Operation aborted");
  }
}

export function registerPreview(pi: ExtensionAPI) {
  // --- LLM Tool ---
  pi.registerTool({
    name: "preview_content",
    label: "Preview Content",
    description:
      "Render markdown, LaTeX, diff, or code content to a viewable artifact. Use browser for HTML without Chromium; terminal PNG and PDF require a discovered Chromium executable. Returns an absolute artifact path, and safely serializes mutations to an explicit outputPath.",
    parameters: Type.Object({
      content: Type.Optional(Type.String({ description: "Markdown/LaTeX/code content to render" })),
      filePath: Type.Optional(
        Type.String({ description: "Path to a file to render instead of inline content" }),
      ),
      format: StringEnum(["terminal", "browser", "pdf"] as const, {
        description: "Output format: terminal (PNG), browser (HTML), pdf (PDF file)",
      }),
      outputPath: Type.Optional(Type.String({ description: "Optional output file path" })),
      fontSizePx: Type.Optional(
        Type.Number({ description: "Font size in pixels (10-24, default: 16)" }),
      ),
    }),
    executionMode: "sequential" as const,
    async execute(_toolCallId, params, signal, _onUpdate, ctx) {
      guardAbort(signal);

      let markdown = params.content ?? "";
      if (params.filePath) {
        const resolved = resolvePath(params.filePath, ctx.cwd);
        markdown = await readFile(resolved, "utf-8");
      }

      if (signal?.aborted) {
        throw new Error("Operation aborted");
      }
      if (!markdown) {
        throw new Error("No content to render. Provide content or filePath.");
      }

      const fontSize = Math.min(24, Math.max(10, params.fontSizePx ?? loadConfig().fontSize));

      try {
        const htmlBody = await renderMarkdown(markdown);
        guardAbort(signal);
        const htmlFull = wrapWithTheme(htmlBody, { bg: DEFAULT_BG, fg: DEFAULT_FG }, fontSize);

        if (params.format === "browser") {
          const outPath = params.outputPath
            ? await mutateSelectedOutput(params.outputPath, ctx.cwd, (target) =>
                writeFile(target, htmlFull, "utf-8"),
              )
            : await writeTempFile(htmlFull, ".html");
          guardAbort(signal);
          const opened = openWithBrowser(outPath);
          return {
            content: [
              {
                type: "text",
                text: opened
                  ? `Preview opened in browser: ${outPath}`
                  : `Preview saved as HTML (browser launch unavailable): ${outPath}`,
              },
            ],
            details: { format: "html", path: outPath, opened },
          };
        }

        if (params.format === "pdf") {
          const outPath = params.outputPath
            ? await mutateSelectedOutput(params.outputPath, ctx.cwd, (target) =>
                exportToPdf(htmlFull, target).then(() => undefined),
              )
            : await writeTempFile("", ".pdf");
          if (!params.outputPath) await exportToPdf(htmlFull, outPath);
          guardAbort(signal);
          return {
            content: [{ type: "text", text: `PDF exported: ${outPath}` }],
            details: { format: "pdf", path: outPath },
          };
        }

        // Terminal format: write HTML, convert to PNG via Puppeteer
        const htmlPath = await writeTempFile("", ".html");
        await writeFile(htmlPath, htmlFull, "utf-8");
        const pngPath = params.outputPath
          ? resolvePath(params.outputPath, ctx.cwd)
          : htmlPath.replace(/\.html$/, ".png");
        try {
          if (params.outputPath) {
            await mutateSelectedOutput(params.outputPath, ctx.cwd, (target) =>
              exportToPng(htmlFull, target).then(() => undefined),
            );
          } else {
            await exportToPng(htmlFull, pngPath);
          }
          guardAbort(signal);
          return {
            content: [{ type: "text", text: `Preview rendered to PNG: ${pngPath}` }],
            details: { format: "png", path: pngPath },
          };
        } catch {
          throw new Error(`Terminal preview unavailable (Puppeteer). HTML saved to: ${htmlPath}`);
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        throw new Error(`Preview failed: ${msg}`);
      }
    },
    renderCall(args, theme, _context) {
      const format = args.format ?? "browser";
      return new Text(
        theme.fg("toolTitle", theme.bold("preview ")) + theme.fg("muted", format),
        0,
        0,
      );
    },
    renderResult(result: any, _options, theme, _context) {
      const path = result.details?.path ?? "";
      return new Text(theme.fg("success", "✓ ") + theme.fg("dim", path), 0, 0);
    },
  });

  // --- Interactive Commands ---
  pi.registerCommand("preview", {
    description:
      "Preview markdown. Usage: /preview [content|file] [--browser] [--pdf] [--font-size N]",
    handler: async (args, ctx: ExtensionCommandContext) => {
      if (!ctx.hasUI) return;
      if (!args) {
        ctx.ui.notify(
          "Usage: /preview <content|file> [--browser] [--pdf] [--font-size N]",
          "warning",
        );
        return;
      }

      const useBrowser = args.includes("--browser");
      const usePdf = args.includes("--pdf");
      const fontSizeMatch = args.match(/--font-size\s+(\d+)/);
      const fontSize = fontSizeMatch ? parseInt(fontSizeMatch[1], 10) : loadConfig().fontSize;
      const cleanArgs = args
        .replace(/ --browser/g, "")
        .replace(/ --pdf/g, "")
        .replace(/ --font-size\s+\d+/g, "")
        .trim();

      const isFile = !cleanArgs.includes(" ") && existsSync(resolvePath(cleanArgs, ctx.cwd));

      let content: string;
      if (isFile) {
        const resolved = resolvePath(cleanArgs, ctx.cwd);
        content = await readFile(resolved, "utf-8");
      } else {
        content = cleanArgs;
      }

      try {
        const htmlBody = await renderMarkdown(content);
        const htmlFull = wrapWithTheme(htmlBody, { bg: DEFAULT_BG, fg: DEFAULT_FG }, fontSize);
        const tempPath = await writeTempFile(htmlFull, ".html");

        if (usePdf) {
          const pdfPath = tempPath.replace(/\.html$/, ".pdf");
          await exportToPdf(htmlFull, pdfPath);
          const opened = openWithBrowser(pdfPath);
          ctx.ui.notify(`${opened ? "PDF opened" : "PDF saved"}: ${pdfPath}`, "info");
        } else if (useBrowser) {
          const opened = openWithBrowser(tempPath);
          ctx.ui.notify(`${opened ? "Browser opened" : "Preview saved"}: ${tempPath}`, "info");
        } else {
          ctx.ui.notify(`Preview saved: ${tempPath}`, "info");
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        ctx.ui.notify(`Preview failed: ${msg}`, "error");
      }
    },
  });

  pi.registerCommand("preview-browser", {
    description: "Open markdown in browser. Usage: /preview-browser [content|file]",
    handler: async (args, ctx: ExtensionCommandContext) => {
      if (!ctx.hasUI) return;

      let content: string;
      if (args && !args.includes(" ") && existsSync(resolvePath(args, ctx.cwd))) {
        content = await readFile(resolvePath(args, ctx.cwd), "utf-8");
      } else if (args) {
        content = args;
      } else {
        ctx.ui.notify("Provide content or a file path", "warning");
        return;
      }

      try {
        const htmlBody = await renderMarkdown(content);
        const htmlFull = wrapWithTheme(htmlBody, { bg: DEFAULT_BG, fg: DEFAULT_FG }, 15);
        const tempPath = await writeTempFile(htmlFull, ".html");
        const opened = openWithBrowser(tempPath);
        ctx.ui.notify(`${opened ? "Browser opened" : "Preview saved"}: ${tempPath}`, "info");
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        ctx.ui.notify(`Preview failed: ${msg}`, "error");
      }
    },
  });

  pi.registerCommand("preview-pdf", {
    description: "Export markdown to PDF. Usage: /preview-pdf [content|file]",
    handler: async (args, ctx: ExtensionCommandContext) => {
      if (!ctx.hasUI) return;

      let content: string;
      if (args && !args.includes(" ") && existsSync(resolvePath(args, ctx.cwd))) {
        content = await readFile(resolvePath(args, ctx.cwd), "utf-8");
      } else if (args) {
        content = args;
      } else {
        ctx.ui.notify("Provide content or a file path", "warning");
        return;
      }

      try {
        const htmlBody = await renderMarkdown(content);
        const htmlFull = wrapWithTheme(htmlBody, { bg: DEFAULT_BG, fg: DEFAULT_FG }, 16);
        const pdfPath = await writeTempFile("", ".pdf");
        await exportToPdf(htmlFull, pdfPath);
        const opened = openWithBrowser(pdfPath);
        ctx.ui.notify(`${opened ? "PDF opened" : "PDF saved"}: ${pdfPath}`, "info");
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        ctx.ui.notify(`PDF failed: ${msg}`, "error");
      }
    },
  });

  pi.registerCommand("preview-clear-cache", {
    description: "Clear the preview cache",
    handler: async (_args, ctx: ExtensionCommandContext) => {
      if (!ctx.hasUI) return;
      const confirmed = await ctx.ui.confirm(
        "Clear ParseView preview cache?",
        "Delete all cached preview artifacts?",
      );
      if (!confirmed) return;
      const { previewCache } = await import("../cache");
      await previewCache.clear();
      ctx.ui.notify("ParseView preview cache cleared", "info");
    },
  });
}
