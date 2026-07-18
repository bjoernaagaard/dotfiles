import { mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import {
  DEFAULT_MAX_BYTES,
  DEFAULT_MAX_LINES,
  formatSize,
  truncateHead,
  withFileMutationQueue,
} from "@earendil-works/pi-coding-agent";
import { renderMermaidASCII, renderMermaidSVG } from "beautiful-mermaid";
import { detectMermaidTheme } from "../theme";
import { resolvePath, writeTempFile } from "../utils";

export type DiagramFormat = "ascii" | "svg" | "html";
export interface DiagramRenderResult {
  text: string;
  details: { format: DiagramFormat; path?: string; truncated?: boolean };
}

function guardAbort(signal?: AbortSignal): void {
  if (signal?.aborted) throw new Error("Operation aborted");
}

async function writeSelectedOutput(
  outputPath: string,
  cwd: string,
  content: string,
): Promise<string> {
  const target = resolvePath(outputPath, cwd);
  await withFileMutationQueue(target, async () => {
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, content, "utf8");
  });
  return target;
}

export async function runDiagramRender(
  code: string,
  format: DiagramFormat,
  outputPath: string | undefined,
  cwd: string,
  signal?: AbortSignal,
): Promise<DiagramRenderResult> {
  guardAbort(signal);
  const theme = detectMermaidTheme();

  if (format === "ascii") {
    try {
      const ascii = renderMermaidASCII(code, { useAscii: false });
      guardAbort(signal);
      const truncation = truncateHead(ascii, {
        maxLines: DEFAULT_MAX_LINES,
        maxBytes: DEFAULT_MAX_BYTES,
      });
      if (!truncation.truncated) {
        return { text: truncation.content, details: { format: "ascii", truncated: false } };
      }

      const fullPath = await writeTempFile(ascii, ".txt");
      return {
        text:
          `${truncation.content}\n\n[Output truncated: ${truncation.outputLines} of ${truncation.totalLines} lines ` +
          `(${formatSize(truncation.outputBytes)} of ${formatSize(truncation.totalBytes)}). ` +
          `Full output saved to: ${fullPath}]`,
        details: { format: "ascii", path: fullPath, truncated: true },
      };
    } catch (error) {
      if (signal?.aborted) throw error;
      const svg = renderMermaidSVG(code, theme);
      guardAbort(signal);
      const finalPath = outputPath
        ? await writeSelectedOutput(outputPath, cwd, svg)
        : await writeTempFile(svg, ".svg");
      return {
        text: `Diagram too complex for ASCII. SVG saved: ${finalPath}`,
        details: { format: "svg", path: finalPath },
      };
    }
  }

  const svg = renderMermaidSVG(code, theme);
  guardAbort(signal);
  const content =
    format === "html"
      ? `<!DOCTYPE html><html><body style="background:${theme.bg};padding:20px">${svg}</body></html>`
      : svg;
  const finalPath = outputPath
    ? await writeSelectedOutput(outputPath, cwd, content)
    : await writeTempFile(content, format === "html" ? ".html" : ".svg");

  return {
    text:
      format === "html"
        ? `Diagram saved as HTML: ${finalPath}`
        : `Diagram saved as SVG: ${finalPath}`,
    details: { format, path: finalPath },
  };
}
