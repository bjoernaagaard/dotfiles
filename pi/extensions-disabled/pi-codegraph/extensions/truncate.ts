import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { PI_MAX_OUTPUT_BYTES, PI_MAX_OUTPUT_LINES } from "./types.ts";

export interface TruncationResult {
	text: string;
	truncated: boolean;
	totalLines: number;
	outputLines: number;
	totalBytes: number;
	outputBytes: number;
	truncatedOutputPath?: string;
}

function sliceUtf8(text: string, maxBytes: number): string {
	if (Buffer.byteLength(text, "utf8") <= maxBytes) return text;
	let low = 0;
	let high = text.length;
	while (low < high) {
		const middle = Math.ceil((low + high) / 2);
		if (Buffer.byteLength(text.slice(0, middle), "utf8") <= maxBytes) low = middle;
		else high = middle - 1;
	}
	return text.slice(0, low);
}

export function truncateToolText(text: string): TruncationResult {
	const totalBytes = Buffer.byteLength(text, "utf8");
	const lines = text.split("\n");
	const totalLines = lines.length;
	let output = lines.slice(0, PI_MAX_OUTPUT_LINES).join("\n");
	output = sliceUtf8(output, PI_MAX_OUTPUT_BYTES);
	let outputLines = output === "" ? 0 : output.split("\n").length;
	let outputBytes = Buffer.byteLength(output, "utf8");
	const truncated = totalLines > outputLines || totalBytes > outputBytes;
	if (!truncated) return { text: output, truncated, totalLines, outputLines, totalBytes, outputBytes };

	const directory = mkdtempSync(path.join(tmpdir(), "pi-codegraph-output-"));
	const fullPath = path.join(directory, "tool-output.txt");
	writeFileSync(fullPath, text, { encoding: "utf8", mode: 0o600 });
	const notice = `\n[Output truncated; full output: ${fullPath}]`;
	const budget = Math.max(0, PI_MAX_OUTPUT_BYTES - Buffer.byteLength(notice, "utf8"));
	output = sliceUtf8(lines.slice(0, Math.max(0, PI_MAX_OUTPUT_LINES - 1)).join("\n"), budget) + notice;
	outputLines = output.split("\n").length;
	outputBytes = Buffer.byteLength(output, "utf8");
	return {
		text: output,
		truncated: true,
		totalLines,
		outputLines,
		totalBytes,
		outputBytes,
		truncatedOutputPath: fullPath,
	};
}
