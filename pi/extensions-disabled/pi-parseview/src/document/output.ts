import {
  DEFAULT_MAX_BYTES,
  DEFAULT_MAX_LINES,
  formatSize,
  truncateHead,
} from "@earendil-works/pi-coding-agent";
import { writeTempFile } from "../utils";

export interface BoundedDocumentOutput {
  text: string;
  truncated: boolean;
  outputLines: number;
  totalLines: number;
  outputBytes: number;
  totalBytes: number;
  fullOutputPath?: string;
}

export interface BoundedDocumentOutputOptions {
  extension?: string;
  recoveryMessage?: string;
  saveFullOutput?: boolean;
}

export async function formatBoundedDocumentOutput(
  fullText: string,
  options: BoundedDocumentOutputOptions = {},
): Promise<BoundedDocumentOutput> {
  const truncation = truncateHead(fullText, {
    maxLines: DEFAULT_MAX_LINES,
    maxBytes: DEFAULT_MAX_BYTES,
  });
  if (!truncation.truncated) return { text: truncation.content, ...truncation };

  const fullOutputPath = options.saveFullOutput
    ? await writeTempFile(fullText, options.extension ?? ".txt")
    : undefined;
  const recovery = fullOutputPath
    ? ` Full output saved to: ${fullOutputPath}.`
    : options.recoveryMessage
      ? ` ${options.recoveryMessage}`
      : "";
  const notice =
    `[Output truncated: showing ${truncation.outputLines} of ${truncation.totalLines} lines ` +
    `(${formatSize(truncation.outputBytes)} of ${formatSize(truncation.totalBytes)}).${recovery}]`;

  return {
    text: `${truncation.content}\n\n${notice}`,
    ...truncation,
    fullOutputPath,
  };
}

export { DEFAULT_MAX_BYTES, DEFAULT_MAX_LINES };
