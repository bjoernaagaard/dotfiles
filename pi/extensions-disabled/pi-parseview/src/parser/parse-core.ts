import { access } from "node:fs/promises";
import { dirname } from "node:path";
import type { ParseResult } from "./types";
import { initParseDocumentRuntime } from "../document/index";

let liteparseAvailable = true;

export function setLiteparseAvailable(available: boolean): void {
  liteparseAvailable = available;
}

export function isLiteparseAvailable(): boolean {
  return liteparseAvailable;
}

export async function parseDocument(
  filePath: string,
  pages?: string,
  useOcr?: boolean,
): Promise<ParseResult> {
  if (!filePath) throw new Error("File path is required");

  if (!liteparseAvailable) {
    throw new Error(
      "Document parsing unavailable: LiteParse native module failed to load. " +
        "Try reinstalling pi-parseview.",
    );
  }

  try {
    await access(filePath);
  } catch {
    throw new Error(`File not found: ${filePath}`);
  }

  try {
    const runtime = await initParseDocumentRuntime();
    const outcome = await runtime.service.parse(
      {
        path: filePath,
        targetPages: pages,
        format: "markdown",
        force: false,
        ocrMode: useOcr === undefined ? "auto" : useOcr ? "on" : "off",
      },
      { cwd: dirname(filePath) },
    );
    return {
      text: outcome.documentMarkdown ?? outcome.documentText,
      pages: outcome.manifest.pageCount,
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (/ocr|tesseract/i.test(msg)) {
      throw new Error(`OCR failed. Try disabling OCR with useOcr: false. (${msg})`);
    }
    throw new Error(`Parse failed: ${msg}`);
  }
}
