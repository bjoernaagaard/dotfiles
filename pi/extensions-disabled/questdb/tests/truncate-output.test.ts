import { existsSync, readFileSync, unlinkSync } from "node:fs";
import { describe, expect, test } from "vitest";
import { formatWithTruncation, writeTempFile } from "../src/truncate-output.ts";

describe("truncate-output", () => {
	test("writeTempFile persists full content", () => {
		const path = writeTempFile("hello questdb", { prefix: "pi-questdb-test", extension: ".txt" });
		try {
			expect(existsSync(path)).toBe(true);
			expect(path).toContain("pi-questdb-test");
			expect(path.endsWith(".txt")).toBe(true);
			expect(readFileSync(path, "utf8")).toBe("hello questdb");
		} finally {
			unlinkSync(path);
		}
	});

	test("formatWithTruncation returns full content when under limits", () => {
		const full = JSON.stringify({ rows: [[1], [2], [3]] }, null, 2);
		const result = formatWithTruncation(full, { maxLines: 100, maxBytes: 10_000 });
		expect(result.truncation.truncated).toBe(false);
		expect(result.fullOutputPath).toBeUndefined();
		expect(result.text).toBe(full);
		expect(result.text).not.toContain("Full output saved to:");
	});

	test("formatWithTruncation writes full output and recovery path when truncated", () => {
		const full = Array.from({ length: 50 }, (_, i) => `row-${i} ${"x".repeat(40)}`).join("\n");
		const result = formatWithTruncation(full, {
			maxLines: 5,
			maxBytes: 50_000,
			prefix: "pi-questdb-test-trunc",
			extension: ".json",
		});
		expect(result.truncation.truncated).toBe(true);
		expect(result.fullOutputPath).toBeTruthy();
		expect(result.text).toContain("Output truncated:");
		expect(result.text).toContain(`Full output saved to: ${result.fullOutputPath}`);
		// LLM-facing text is truncated; recovery file has the complete payload
		expect(result.text.startsWith(result.truncation.content)).toBe(true);
		expect(result.truncation.content.length).toBeLessThan(full.length);
		try {
			expect(readFileSync(result.fullOutputPath!, "utf8")).toBe(full);
		} finally {
			if (result.fullOutputPath) unlinkSync(result.fullOutputPath);
		}
	});

	test("formatWithTruncation truncates by bytes and still provides full file", () => {
		const full = "abcdefghij\n".repeat(200);
		const result = formatWithTruncation(full, {
			maxLines: 2000,
			maxBytes: 80,
			prefix: "pi-questdb-test-bytes",
		});
		expect(result.truncation.truncated).toBe(true);
		expect(result.truncation.truncatedBy).toBe("bytes");
		expect(result.fullOutputPath).toBeTruthy();
		try {
			expect(readFileSync(result.fullOutputPath!, "utf8")).toBe(full);
		} finally {
			if (result.fullOutputPath) unlinkSync(result.fullOutputPath);
		}
	});
});
