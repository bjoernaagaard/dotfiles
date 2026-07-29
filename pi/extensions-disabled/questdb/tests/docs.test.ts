import { describe, expect, test } from "vitest";
import { parseDocsReferences, resolveDocsRequest } from "../src/docs.ts";

describe("docs tooling", () => {
	test("parses markdown .md URLs from llms.txt lines", () => {
		const sample = `
* [Ingestion docs](https://questdb.com/docs/ingest/overview.md)
- https://questdb.com/docs/core/query-language/selecting-and-inserting.md#overview
* [Broken](https://example.com/other.md)
`;
		const refs = parseDocsReferences(sample);
		expect(refs).toHaveLength(2);
		expect(refs[0].url).toMatch(/ingest\/overview\.md/);
		expect(refs[1].url).toMatch(/query-language\/selecting-and-inserting\.md/);
	});

	test("resolves docs path and enforces restrictions", () => {
		expect(resolveDocsRequest("ingestion/overview")).toBe("https://questdb.com/docs/ingestion/overview.md");
		expect(resolveDocsRequest("quickstart/intro.md")).toBe("https://questdb.com/docs/quickstart/intro.md");
		expect(() => resolveDocsRequest("../../secret")).toThrow(/\.{2}/);
		expect(() => resolveDocsRequest("https://evil.com/docs/x.md")).toThrow(/https:\/\/questdb\.com\/docs\//);
		expect(resolveDocsRequest("https://questdb.com/docs/quickstart/")).toBe("https://questdb.com/docs/quickstart/index.md");
	});
});
