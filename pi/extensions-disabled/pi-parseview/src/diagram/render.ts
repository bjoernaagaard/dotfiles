import { mkdir, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
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
import {
  detectMermaidDiagramKind,
  normalizeMermaidCode,
  resolvePath,
  writeTempFile,
} from "../utils";

export type DiagramFormat = "ascii" | "svg" | "html";
export interface DiagramRenderResult {
  text: string;
  details: { format: DiagramFormat; path?: string; truncated?: boolean };
}

function guardAbort(signal?: AbortSignal): void {
  if (signal?.aborted) throw new Error("Operation aborted");
}

function escapeXmlText(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

/** Add a stable accessible name to Beautiful Mermaid's otherwise anonymous SVG. */
export function addSvgAccessibilityMetadata(svg: string, code: string): string {
  const openingTag = svg.match(/^<svg\b([^>]*)>/);
  if (!openingTag || !svg.includes("</svg>")) return svg;

  const digest = createHash("sha256").update(code).digest("hex").slice(0, 12);
  const titleId = `mermaid-title-${digest}`;
  const descId = `mermaid-desc-${digest}`;
  const kind = detectMermaidDiagramKind(code);
  const header =
    code
      .split("\n")
      .map((line) => line.trim())
      .find((line) => line.length > 0 && !line.startsWith("%%")) ?? "Mermaid diagram";
  const accessible =
    `<svg${openingTag[1]} role="img" aria-labelledby="${titleId} ${descId}">` +
    `<title id="${titleId}">${escapeXmlText(`Mermaid ${kind} diagram`)}</title>` +
    `<desc id="${descId}">${escapeXmlText(`Rendered from Mermaid header ${header}.`)}</desc>`;

  return accessible + svg.slice(openingTag[0].length);
}

function asciiThemeFromDiagramColors(theme: ReturnType<typeof detectMermaidTheme>) {
  return {
    fg: theme.fg,
    border: theme.border ?? theme.line ?? theme.fg,
    line: theme.line ?? theme.fg,
    arrow: theme.accent ?? theme.fg,
    accent: theme.accent,
    bg: theme.bg,
  };
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
  themeName?: string,
): Promise<DiagramRenderResult> {
  guardAbort(signal);
  const preparedCode = normalizeMermaidCode(code);
  detectMermaidDiagramKind(preparedCode);
  const theme = detectMermaidTheme(themeName);

  if (format === "ascii") {
    try {
      const ascii = renderMermaidASCII(preparedCode, {
        useAscii: false,
        colorMode: "none",
        theme: asciiThemeFromDiagramColors(theme),
      });
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
      const svg = addSvgAccessibilityMetadata(renderMermaidSVG(preparedCode, theme), preparedCode);
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

  const svg = addSvgAccessibilityMetadata(renderMermaidSVG(preparedCode, theme), preparedCode);
  guardAbort(signal);
  const content =
    format === "html"
      ? `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Mermaid diagram</title><style>body{background:${theme.bg};padding:20px}svg{max-width:100%;height:auto}</style></head><body>${svg}</body></html>`
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
