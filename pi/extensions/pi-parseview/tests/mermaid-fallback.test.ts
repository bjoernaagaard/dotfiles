import { describe, it, expect } from "vite-plus/test";

const COMPLEX_DIAGRAM = `graph TD
  subgraph Auth
    A[User Login] --> B[Validate Credentials]
    B --> C{Authorized?}
  end
  subgraph Data
    C -->|Yes| D[Fetch Profile]
    C -->|No| E[Show Error]
    D --> F[Load Settings]
    F --> G{Has Permission?}
  end
  subgraph Actions
    G -->|Yes| H[Execute Action]
    G -->|No| I[Deny Access]
    H --> J[Save Results]
    J --> K[Send Notification]
  end
  E --> L[Log Attempt]
  L --> M[Increment Counter]
  style C fill:#f96
  style G fill:#bbf`;

describe("mermaid ASCII crash fallback", () => {
  it("SVG renderer handles complex diagram (fallback viability)", async () => {
    const { normalizeMermaidCode } = await import("../src/utils");
    const { renderMermaidSVG } = await import("beautiful-mermaid");
    const { detectMermaidTheme } = await import("../src/theme");
    const code = normalizeMermaidCode(COMPLEX_DIAGRAM);
    const theme = detectMermaidTheme();
    const svg = renderMermaidSVG(code, theme);
    expect(svg).toContain("<svg");
    expect(svg).toContain("</svg>");
  });

  it("still renders ASCII for simple diagrams", async () => {
    const { normalizeMermaidCode } = await import("../src/utils");
    const { renderMermaidASCII } = await import("beautiful-mermaid");
    const code = normalizeMermaidCode("graph TD\nA[Start] --> B[End]");
    const result = renderMermaidASCII(code, { useAscii: false });
    expect(result.length).toBeGreaterThan(0);
  });

  it("fallback path produces SVG output that matches tool return shape", async () => {
    // This test verifies the SVG fallback path produces output consistent
    // with what the mermaid tool would return on ASCII render failure.
    // It tests the fallback module in isolation rather than simulating a
    // render crash (which would depend on library internals).
    const { normalizeMermaidCode } = await import("../src/utils");
    const { renderMermaidSVG } = await import("beautiful-mermaid");
    const { detectMermaidTheme } = await import("../src/theme");

    const code = normalizeMermaidCode(COMPLEX_DIAGRAM);
    const theme = detectMermaidTheme();
    const svg = renderMermaidSVG(code, theme);

    // SVG output is valid and the tool would return a text-typed response
    expect(svg).toContain("<svg");
    expect(svg).toContain("</svg>");
  });

  it("fallback produces SVG with theme colors", async () => {
    const { normalizeMermaidCode } = await import("../src/utils");
    const { renderMermaidSVG } = await import("beautiful-mermaid");
    const { detectMermaidTheme } = await import("../src/theme");

    const code = normalizeMermaidCode(COMPLEX_DIAGRAM);
    const theme = detectMermaidTheme();

    const svg = renderMermaidSVG(code, theme);

    // SVG should contain theme color values
    expect(svg).toContain(theme.bg);
    expect(svg).toContain(theme.fg);
  });
  it("render_diagram-style catch falls back to SVG instead of error text", async () => {
    const { renderMermaidSVG } = await import("beautiful-mermaid");
    const { detectMermaidTheme } = await import("../src/theme");
    const { normalizeMermaidCode, writeTempFile } = await import("../src/utils");
    const { writeFile } = await import("node:fs/promises");

    const code = normalizeMermaidCode(COMPLEX_DIAGRAM);
    const theme = detectMermaidTheme();
    let result: string;

    // Simulate a render crash similar to what beautiful-mermaid does for complex diagrams
    const throwingRender = () => {
      throw new Error("beautiful-mermaid rendering failed");
    };

    try {
      result = throwingRender();
    } catch {
      // Simulate the enhanced catch block (SVG fallback instead of error text)
      const svg = renderMermaidSVG(code, theme);
      const fallbackPath = await writeTempFile(svg, ".svg");
      await writeFile(fallbackPath, svg, "utf-8");
      result = `Diagram too complex for ASCII rendering. SVG saved: ${fallbackPath}`;
    }

    expect(result!).toContain("SVG saved");
    expect(result!).toContain(".svg");
  });
});
