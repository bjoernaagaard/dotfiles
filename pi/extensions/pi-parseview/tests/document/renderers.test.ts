import { describe, it, expect } from "vite-plus/test";
import {
  renderParseCall,
  renderParseResult,
  renderQueryCall,
  renderQueryResult,
  renderScreenshotCall,
  renderScreenshotResult,
} from "../../src/document/renderers";

describe("document renderers", () => {
  it("renders compact call and partial/error states", () => {
    expect(
      renderParseCall({ path: "./doc.pdf", format: "text" }, {}, {}).render(80).join("\n"),
    ).toContain("parse_document ./doc.pdf");
    expect(
      renderQueryCall({ documentId: "a".repeat(24), action: "search" }, {}, {})
        .render(80)
        .join("\n"),
    ).toContain("query_document");
    expect(
      renderScreenshotCall({ documentId: "a".repeat(24), pages: [1, 2], dpi: 150 }, {}, {})
        .render(80)
        .join("\n"),
    ).toContain("pages=1,2");

    expect(
      renderParseResult(
        { details: { phase: "validating" } },
        { expanded: false, isPartial: true },
        {},
        {},
      )
        .render(80)
        .join("\n")
        .trimEnd(),
    ).toBe("parse: validating");
    expect(
      renderQueryResult(
        { details: { error: "boom" } },
        { expanded: false, isPartial: false },
        {},
        {},
      )
        .render(80)
        .join("\n")
        .trimEnd(),
    ).toBe("query error: boom");
    expect(
      renderScreenshotResult(
        { details: { error: "boom" } },
        { expanded: false, isPartial: false },
        {},
        {},
      )
        .render(80)
        .join("\n")
        .trimEnd(),
    ).toBe("screenshot error: boom");
  });

  it("renders expanded summaries without full previews", () => {
    const parse = renderParseResult(
      {
        details: {
          documentId: "a".repeat(24),
          pageCount: 2,
          cacheHit: true,
          ocrModeResolved: "off",
          source: "/tmp/doc.pdf",
          format: "markdown",
          artifactPaths: ["/tmp/document.txt", "/tmp/pages.json.gz"],
        },
      },
      { expanded: true, isPartial: false },
      {},
      {},
    )
      .render(120)
      .join("\n");
    expect(parse).toContain("parse_document doc=");
    expect(parse).toContain("artifacts=/tmp/document.txt,/tmp/pages.json.gz");

    const query = renderQueryResult(
      {
        details: {
          action: "search",
          documentId: "a".repeat(24),
          matchCount: 1,
        },
      },
      { expanded: true, isPartial: false },
      {},
      {},
    )
      .render(120)
      .join("\n");
    expect(query).toContain("query_document search");
    expect(query).toContain("matches=1");

    const screenshot = renderScreenshotResult(
      {
        details: {
          pageCount: 2,
          pages: [{ pageNum: 1, path: "screenshots/page-1-150.png" }],
        },
      },
      { expanded: true, isPartial: false },
      {},
      {},
    )
      .render(120)
      .join("\n");
    expect(screenshot).toContain("screenshot_document 2 page(s)");
    expect(screenshot).toContain("page-1-150.png");
  });
});
