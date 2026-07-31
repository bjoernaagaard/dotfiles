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
import { parseCommandLine } from "../command-args";
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

export interface PreviewCommandArgs {
  content: string;
  useBrowser: boolean;
  usePdf: boolean;
  fontSize?: number;
}

export function parsePreviewCommandArgs(args: string): PreviewCommandArgs {
  const tokens = parseCommandLine(args);
  const contentTokens: string[] = [];
  let useBrowser = false;
  let usePdf = false;
  let fontSize: number | undefined;

  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index];
    if (token === "--browser") {
      useBrowser = true;
    } else if (token === "--pdf") {
      usePdf = true;
    } else if (token === "--font-size" && /^\d+$/.test(tokens[index + 1] ?? "")) {
      fontSize = Number(tokens[index + 1]);
      index += 1;
    } else {
      contentTokens.push(token);
    }
  }

  return { content: contentTokens.join(" ").trim(), useBrowser, usePdf, fontSize };
}

async function readPreviewCommandContent(tokens: string[], cwd: string): Promise<string> {
  const candidate = tokens.join(" ").trim();
  if (!candidate) throw new Error("Provide content or a file path");
  const resolved = resolvePath(candidate, cwd);
  return existsSync(resolved) ? readFile(resolved, "utf-8") : candidate;
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
      format: Type.Optional(
        StringEnum(["terminal", "browser", "pdf"] as const, {
          description:
            "Output format: terminal (PNG), browser (HTML), pdf (PDF file); defaults to configured defaultFormat",
        }),
      ),
      outputPath: Type.Optional(Type.String({ description: "Optional output file path" })),
      fontSizePx: Type.Optional(
        Type.Number({
          description: "Font size in pixels (10-24, defaults to configured fontSize)",
        }),
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

      const format = params.format ?? loadConfig().defaultFormat;
      const fontSize = Math.min(24, Math.max(10, params.fontSizePx ?? loadConfig().fontSize));

      try {
        const htmlBody = await renderMarkdown(markdown);
        guardAbort(signal);
        const htmlFull = wrapWithTheme(htmlBody, { bg: DEFAULT_BG, fg: DEFAULT_FG }, fontSize);

        if (format === "browser") {
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

        if (format === "pdf") {
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
      const format = args.format ?? loadConfig().defaultFormat;
      return new Text(
        theme.fg("toolTitle", theme.bold("preview ")) + theme.fg("muted", format),
        0,
        0,
      );
    },
    renderResult(result: any, _options, theme, context) {
      if (context.isError) {
        const message = result.content.find((entry: any) => entry.type === "text")?.text;
        return new Text(
          theme.fg("error", `preview error: ${message || "Tool execution failed"}`),
          0,
          0,
        );
      }
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

      let content: string;
      let commandArgs: PreviewCommandArgs;
      try {
        commandArgs = parsePreviewCommandArgs(args);
        content = await readPreviewCommandContent([commandArgs.content], ctx.cwd);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        ctx.ui.notify(`Preview failed: ${msg}`, "error");
        return;
      }

      const format = commandArgs.usePdf
        ? "pdf"
        : commandArgs.useBrowser
          ? "browser"
          : loadConfig().defaultFormat;
      const fontSize = commandArgs.fontSize ?? loadConfig().fontSize;

      try {
        const htmlBody = await renderMarkdown(content);
        const htmlFull = wrapWithTheme(htmlBody, { bg: DEFAULT_BG, fg: DEFAULT_FG }, fontSize);
        const tempPath = await writeTempFile(htmlFull, ".html");

        if (format === "pdf") {
          const pdfPath = tempPath.replace(/\.html$/, ".pdf");
          await exportToPdf(htmlFull, pdfPath);
          const opened = openWithBrowser(pdfPath);
          ctx.ui.notify(`${opened ? "PDF opened" : "PDF saved"}: ${pdfPath}`, "info");
        } else if (format === "browser") {
          const opened = openWithBrowser(tempPath);
          ctx.ui.notify(`${opened ? "Browser opened" : "Preview saved"}: ${tempPath}`, "info");
        } else {
          const pngPath = tempPath.replace(/\.html$/, ".png");
          await exportToPng(htmlFull, pngPath);
          ctx.ui.notify(`Preview rendered: ${pngPath}`, "info");
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
      try {
        content = await readPreviewCommandContent(parseCommandLine(args ?? ""), ctx.cwd);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        ctx.ui.notify(message, "warning");
        return;
      }

      try {
        const htmlBody = await renderMarkdown(content);
        const htmlFull = wrapWithTheme(
          htmlBody,
          { bg: DEFAULT_BG, fg: DEFAULT_FG },
          loadConfig().fontSize,
        );
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
      try {
        content = await readPreviewCommandContent(parseCommandLine(args ?? ""), ctx.cwd);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        ctx.ui.notify(message, "warning");
        return;
      }

      try {
        const htmlBody = await renderMarkdown(content);
        const htmlFull = wrapWithTheme(
          htmlBody,
          { bg: DEFAULT_BG, fg: DEFAULT_FG },
          loadConfig().fontSize,
        );
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
}
