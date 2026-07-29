import { randomUUID } from "node:crypto";
import { writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	DEFAULT_MAX_BYTES,
	DEFAULT_MAX_LINES,
	formatSize,
	truncateHead,
	type TruncationResult,
} from "@earendil-works/pi-coding-agent";

export type FormatWithTruncationOptions = {
	maxLines?: number;
	maxBytes?: number;
	/** Temp file name prefix (default: pi-questdb). */
	prefix?: string;
	/** Temp file extension including the dot (default: .txt). */
	extension?: string;
};

export type FormattedTruncation = {
	/** Truncated content plus recovery notice when truncated. */
	text: string;
	/** truncateHead result metadata. */
	truncation: TruncationResult;
	/** Absolute path to full output when truncated; otherwise undefined. */
	fullOutputPath?: string;
};

/**
 * Write full tool output to a unique temp file.
 * writeTempFile is not exported by @earendil-works/pi-coding-agent, so we mirror the docs pattern.
 */
export function writeTempFile(
	content: string,
	options: { prefix?: string; extension?: string } = {},
): string {
	const prefix = options.prefix?.trim() || "pi-questdb";
	const extension = options.extension?.startsWith(".") ? options.extension : options.extension ? `.${options.extension}` : ".txt";
	const filePath = join(tmpdir(), `${prefix}-${randomUUID()}${extension}`);
	writeFileSync(filePath, content, "utf8");
	return filePath;
}

/**
 * Truncate tool output with Pi defaults. When truncated, write the full output
 * to a temp file and append a notice with the recovery path for the LLM.
 */
export function formatWithTruncation(
	fullOutput: string,
	options: FormatWithTruncationOptions = {},
): FormattedTruncation {
	const maxLines = options.maxLines ?? DEFAULT_MAX_LINES;
	const maxBytes = options.maxBytes ?? DEFAULT_MAX_BYTES;
	const truncation = truncateHead(fullOutput, { maxLines, maxBytes });

	if (!truncation.truncated) {
		return { text: truncation.content, truncation };
	}

	const fullOutputPath = writeTempFile(fullOutput, {
		prefix: options.prefix,
		extension: options.extension,
	});

	const notice =
		`\n\n[Output truncated: ${truncation.outputLines} of ${truncation.totalLines} lines` +
		` (${formatSize(truncation.outputBytes)} of ${formatSize(truncation.totalBytes)}).` +
		` Full output saved to: ${fullOutputPath}]`;

	return {
		text: `${truncation.content}${notice}`,
		truncation,
		fullOutputPath,
	};
}
