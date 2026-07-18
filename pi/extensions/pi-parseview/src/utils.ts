/** Normalize semicolons to newlines — beautiful-mermaid does not accept `;` separators */
export function normalizeMermaidCode(code: string): string {
  return code.replace(/;\s*/g, "\n");
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
