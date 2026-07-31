import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vite-plus/test";
import {
  DEFAULT_MAX_BYTES,
  DEFAULT_MAX_LINES,
  formatBoundedDocumentOutput,
} from "../../src/document/output";
import { formatQueryReadResult, formatQuerySearchResult } from "../../src/document/tools/query";
import { formatScreenshotResult } from "../../src/document/tools/screenshot";

const documentId = "a".repeat(24);
const manifest = {} as any;

describe("document output bounds", () => {
  it("preserves small output and reports exact counts", async () => {
    const result = await formatBoundedDocumentOutput("one\ntwo");
    expect(result).toMatchObject({ text: "one\ntwo", truncated: false, totalLines: 2 });
    expect(result.totalBytes).toBe(Buffer.byteLength("one\ntwo"));
  });

  it("uses official line and UTF-8 byte bounds and saves byte-identical full output", async () => {
    const byLines = Array.from(
      { length: DEFAULT_MAX_LINES + 2 },
      (_, index) => `line ${index}`,
    ).join("\n");
    const lineResult = await formatBoundedDocumentOutput(byLines, { saveFullOutput: true });
    expect(lineResult.truncated).toBe(true);
    expect(lineResult.text).toContain(
      `showing ${DEFAULT_MAX_LINES} of ${DEFAULT_MAX_LINES + 2} lines`,
    );
    expect(await readFile(lineResult.fullOutputPath!, "utf8")).toBe(byLines);

    const utf8 = "🙂".repeat(DEFAULT_MAX_BYTES);
    const byteResult = await formatBoundedDocumentOutput(utf8);
    expect(byteResult.truncated).toBe(true);
    expect(byteResult.text).not.toContain("�");
    expect(byteResult.outputBytes).toBeLessThanOrEqual(DEFAULT_MAX_BYTES);
  });
});

describe("query result formatting", () => {
  it("preserves bounded reads and distinguishes upstream truncation", async () => {
    const normal = await formatQueryReadResult({
      documentId,
      manifest,
      text: "1: alpha\n2: beta",
      completeText: "1: alpha\n2: beta",
      lines: [
        { lineNumber: 1, text: "alpha" },
        { lineNumber: 2, text: "beta" },
      ] as any,
    });
    expect(normal.content[0].text).toBe("1: alpha\n2: beta");
    expect(normal.details).toMatchObject({ truncated: false, upstreamTruncated: false });

    const completeText = `1: ${"alpha".repeat(DEFAULT_MAX_BYTES)}`;
    const upstream = await formatQueryReadResult({
      documentId,
      manifest,
      text: "1: alpha…",
      completeText,
      lines: [{ lineNumber: 1, text: completeText.slice(3) }] as any,
      truncated: true,
    });
    expect(upstream.content[0].text).toContain("Document service output was bounded");
    expect(upstream.content[0].text).not.toContain("Retry with query_document");
    expect(upstream.details).toMatchObject({
      truncated: true,
      upstreamTruncated: true,
      continuationStartLine: undefined,
    });
    expect(await readFile(upstream.details.fullOutputPath!, "utf8")).toBe(completeText);
  });

  it("provides an exact continuation for formatter-truncated line reads", async () => {
    const lines = Array.from({ length: DEFAULT_MAX_LINES + 10 }, (_, index) => ({
      lineNumber: index + 1,
      text: `line ${index + 1}`,
    }));
    const completeText = lines.map((line) => `${line.lineNumber}: ${line.text}`).join("\n");
    const result = await formatQueryReadResult({
      documentId,
      manifest,
      text: completeText,
      completeText,
      lines: lines as any,
    });
    expect(result.details.outputTruncated).toBe(true);
    expect(result.content[0].text).toContain("query_document action=read");
    expect(result.content[0].text).toContain("startLine=2001");
    expect(result.content[0].text).toContain("lineCount=200");
  });

  it("saves full output instead of repeating a non-advancing oversized first line", async () => {
    const completeText = `1: ${"🙂".repeat(DEFAULT_MAX_BYTES)}`;
    const result = await formatQueryReadResult({
      documentId,
      manifest,
      text: completeText,
      completeText,
      lines: [{ lineNumber: 1, text: completeText.slice(3) }] as any,
    });

    expect(result.details).toMatchObject({
      truncated: true,
      outputTruncated: true,
      continuationStartLine: undefined,
    });
    expect(result.content[0].text).not.toContain("startLine=1");
    expect(await readFile(result.details.fullOutputPath!, "utf8")).toBe(completeText);
  });

  it("reports result-limit truncation separately and saves complete formatter-truncated search", async () => {
    const limited = await formatQuerySearchResult({
      documentId,
      manifest,
      phrase: "needle",
      matches: [{ pageNum: 1, text: "needle", context: "full context" }],
      truncated: true,
    });
    expect(limited.details).toMatchObject({
      truncated: true,
      resultLimitTruncated: true,
      outputTruncated: false,
    });
    expect(limited.content[0].text).toContain("maxResults");
    expect(limited.content[0].text).toContain("full context");

    const matches = Array.from({ length: DEFAULT_MAX_LINES + 2 }, (_, index) => ({
      pageNum: index + 1,
      text: `needle-${index}`,
      context: `context-${index}`,
    }));
    const large = await formatQuerySearchResult({
      documentId,
      manifest,
      phrase: "needle",
      matches,
      truncated: false,
    });
    expect(large.details).toMatchObject({ truncated: true, outputTruncated: true });
    const full = await readFile(large.details.fullOutputPath!, "utf8");
    expect(full).toContain("needle-0");
    expect(full).toContain(`needle-${DEFAULT_MAX_LINES + 1}`);
  });
});

describe("screenshot result formatting", () => {
  it("preserves image blocks and saves every path when the manifest is truncated", async () => {
    const image = { type: "image" as const, data: "abc", mimeType: "image/png" as const };
    const pages = Array.from({ length: DEFAULT_MAX_LINES + 2 }, (_, index) => ({
      pageNum: index + 1,
      path: `/very/long/path/page-${index + 1}.png`,
      bytes: 10,
      width: 100,
      height: 100,
    }));
    const result = await formatScreenshotResult({
      documentId,
      manifest,
      pages,
      images: [image],
    });
    expect(result.content[1]).toEqual(image);
    expect(result.details.truncated).toBe(true);
    const full = await readFile(result.details.fullOutputPath!, "utf8");
    expect(full).toContain(pages.at(-1)!.path);
  });

  it("bounds only the textual manifest while preserving selected image blocks", async () => {
    const images = Array.from({ length: 4 }, (_, index) => ({
      type: "image" as const,
      data: String(index).repeat(DEFAULT_MAX_BYTES),
      mimeType: "image/png" as const,
    }));
    const pages = Array.from({ length: DEFAULT_MAX_LINES + 1 }, (_, index) => ({
      pageNum: index + 1,
      path: `/screenshots/page-${index + 1}.png`,
      bytes: images[index]?.data.length ?? 10,
      width: 1000,
      height: 1000,
    }));

    const result = await formatScreenshotResult({ documentId, manifest, pages, images });
    expect(result.content.slice(1)).toEqual(images);
    const textContent = result.content[0];
    expect(textContent.type).toBe("text");
    expect(Buffer.byteLength("text" in textContent ? textContent.text : "", "utf8")).toBeLessThan(
      DEFAULT_MAX_BYTES + 1_000,
    );
    expect(result.details).toMatchObject({ imageCount: 4, truncated: true });
  });
});
