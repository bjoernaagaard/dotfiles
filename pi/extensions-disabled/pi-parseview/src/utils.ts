export type MermaidDiagramKind = "flowchart" | "state" | "sequence" | "class" | "er" | "xychart";

const SUPPORTED_MERMAID_HEADERS =
  "graph/flowchart, stateDiagram(-v2), sequenceDiagram, classDiagram, erDiagram, or xychart(-beta)";

/**
 * Remove only leading Mermaid comments/directives. Beautiful Mermaid ignores
 * `%%` lines while parsing, but its diagram-type dispatcher examines the raw
 * first line, so a leading comment can route a sequence/class/etc. diagram
 * through the flowchart parser.
 */
export function stripLeadingMermaidDirectives(code: string): string {
  const lines = code.replace(/\r\n?/g, "\n").split("\n");
  let index = 0;
  while (index < lines.length) {
    const trimmed = lines[index].trim();
    if (trimmed === "" || trimmed.startsWith("%%")) {
      index += 1;
      continue;
    }
    break;
  }
  return lines.slice(index).join("\n");
}

/**
 * Normalize Mermaid's semicolon statement separators without changing
 * semicolons inside quoted labels/messages. Comment lines are preserved so
 * Beautiful Mermaid can continue to ignore them after the header.
 */
export function normalizeMermaidCode(code: string): string {
  const source = stripLeadingMermaidDirectives(code);
  const semicolonBreak = "\u0000";
  const lines = source.split("\n");
  return lines
    .map((line) => {
      if (line.trimStart().startsWith("%%")) return line;

      let quote: '"' | "'" | undefined;
      let escaped = false;
      let normalized = "";
      for (let index = 0; index < line.length; index += 1) {
        const char = line[index];
        if (escaped) {
          normalized += char;
          escaped = false;
          continue;
        }
        if (char === "\\" && quote) {
          normalized += char;
          escaped = true;
          continue;
        }
        if (quote) {
          normalized += char;
          if (char === quote) quote = undefined;
          continue;
        }
        if (char === '"' || char === "'") {
          quote = char;
          normalized += char;
          continue;
        }
        if (char === ";") {
          normalized += semicolonBreak;
          while (index + 1 < line.length && /\s/.test(line[index + 1] ?? "")) index += 1;
          continue;
        }
        normalized += char;
      }
      return normalized;
    })
    .join("\n")
    .replace(new RegExp(`${semicolonBreak}[ \\t]*\\n[ \\t]*`, "g"), "\n")
    .replaceAll(semicolonBreak, "\n");
}

/** Detect the supported diagram family from its first meaningful header. */
export function detectMermaidDiagramKind(code: string): MermaidDiagramKind {
  const header = code
    .split("\n")
    .map((line) => line.trim())
    .find((line) => line.length > 0 && !line.startsWith("%%"));

  if (!header) throw new Error("Mermaid diagram is missing a header");
  if (/^(?:graph|flowchart)\b/i.test(header)) return "flowchart";
  if (/^stateDiagram(?:-v2)?\s*$/i.test(header)) return "state";
  if (/^sequenceDiagram\s*$/i.test(header)) return "sequence";
  if (/^classDiagram\s*$/i.test(header)) return "class";
  if (/^erDiagram\s*$/i.test(header)) return "er";
  if (/^xychart(?:-beta)?\b/i.test(header)) return "xychart";

  throw new Error(
    `Unsupported Mermaid diagram header "${header}". Supported headers: ${SUPPORTED_MERMAID_HEADERS}.`,
  );
}

/** Rewrite relative image paths in parsed markdown to absolute paths */
export function rewriteImagePaths(markdown: string, imageDir: string): string {
  return markdown.replaceAll("![](image_", `![](${imageDir}/image_`);
}

import { writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { randomUUID } from "node:crypto";

export async function writeTempFile(content: string, extension = ".tmp"): Promise<string> {
  const dir = join(tmpdir(), "pi-parseview");
  await mkdir(dir, { recursive: true });
  const path = join(dir, `${randomUUID()}${extension}`);
  await writeFile(path, content, "utf-8");
  return path;
}

export function resolvePath(path: string, cwd: string): string {
  if (path.startsWith("@")) path = path.slice(1);
  if (path.startsWith("/")) return path;
  return resolve(cwd, path);
}
