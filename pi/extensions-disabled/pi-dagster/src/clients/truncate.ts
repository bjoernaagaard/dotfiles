/**
 * Size guards for tool payloads.
 * Prefer Pi truncation helpers when available; local fallback for path write.
 */
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  DEFAULT_MAX_BYTES,
  DEFAULT_MAX_LINES,
  truncateHead,
} from "@earendil-works/pi-coding-agent";

export type TruncateForToolResult = {
  content: string;
  truncated: boolean;
  tempPath?: string;
  totalBytes: number;
  totalLines: number;
};

/**
 * If serialized result exceeds ~50KB or 2000 lines, write full payload to a
 * temp file and return a head summary + path.
 */
export async function truncateForTool(
  value: unknown,
  options?: { maxBytes?: number; maxLines?: number; label?: string },
): Promise<TruncateForToolResult> {
  const text =
    typeof value === "string" ? value : JSON.stringify(value, null, 2) ?? "null";
  const maxBytes = options?.maxBytes ?? DEFAULT_MAX_BYTES;
  const maxLines = options?.maxLines ?? DEFAULT_MAX_LINES;
  const result = truncateHead(text, { maxBytes, maxLines });

  if (!result.truncated) {
    return {
      content: result.content,
      truncated: false,
      totalBytes: result.totalBytes,
      totalLines: result.totalLines,
    };
  }

  const dir = await mkdtemp(join(tmpdir(), "pi-dagster-"));
  const tempPath = join(dir, `${options?.label ?? "payload"}.json`);
  await writeFile(tempPath, text, { encoding: "utf8", mode: 0o600 });

  const summary = [
    result.content,
    "",
    `[truncated: ${result.totalLines} lines / ${result.totalBytes} bytes; full payload: ${tempPath}]`,
  ].join("\n");

  return {
    content: summary,
    truncated: true,
    tempPath,
    totalBytes: result.totalBytes,
    totalLines: result.totalLines,
  };
}

export { DEFAULT_MAX_BYTES, DEFAULT_MAX_LINES, truncateHead };
