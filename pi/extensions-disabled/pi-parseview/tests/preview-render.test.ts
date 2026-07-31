import { describe, it, expect } from "vite-plus/test";
import { renderMarkdown, wrapWithTheme } from "../src/preview/render";

describe("renderMarkdown", () => {
  it("renders basic markdown to HTML", async () => {
    const html = await renderMarkdown("# Hello\n\nWorld");
    expect(html).toContain("<h1");
    expect(html).toContain("Hello");
    expect(html).toContain("World");
  });

  it("renders LaTeX inline math", async () => {
    const html = await renderMarkdown("Formula: $E = mc^2$");
    expect(html).toContain("E");
    expect(html).toContain("mc");
  });

  it("renders LaTeX display math", async () => {
    const html = await renderMarkdown("$$\n\\int x^2 dx\n$$");
    expect(html).toContain("int");
  });

  it("handles empty string", async () => {
    const html = await renderMarkdown("");
    expect(typeof html).toBe("string");
  });
});

describe("wrapWithTheme", () => {
  it("emits CSS custom properties instead of hardcoded colors", () => {
    const result = wrapWithTheme("<p>test</p>", { bg: "#000", fg: "#fff" }, 16);
    expect(result).toContain("--pi-bg: #000");
    expect(result).toContain("--pi-fg: #fff");
    expect(result).toContain("--pi-muted-fg");
    expect(result).toContain("--pi-border");
    expect(result).toContain("--pi-code-bg");
    expect(result).not.toContain("background: #000");
    expect(result).not.toContain("color: #fff");
  });

  it("uses compact density defaults", () => {
    const result = wrapWithTheme("<p>test</p>", { bg: "#111", fg: "#eee" });
    expect(result).toContain("padding: 1.25em");
    expect(result).toContain("line-height: 1.5");
    expect(result).toContain("max-width: 36em");
  });

  it("still includes body content and font-size", () => {
    const result = wrapWithTheme("<p>test</p>", { bg: "#fff", fg: "#000" }, 14);
    expect(result).toContain("<p>test</p>");
    expect(result).toContain("font-size: 14px");
  });

  it("derives muted-fg and border from luminance of input colors", () => {
    // Dark bg → muted-fg should be a translucent version of fg
    const result = wrapWithTheme("<p>hi</p>", { bg: "#1a1a2e", fg: "#e0e0ff" });
    expect(result).toContain("--pi-muted-fg: rgba(224, 224, 255, 0.65)");
    expect(result).toContain("--pi-border: rgba(224, 224, 255, 0.20)");

    // Light bg → same logic applies
    const result2 = wrapWithTheme("<p>hi</p>", { bg: "#ffffff", fg: "#1a1a1a" });
    expect(result2).toContain("--pi-muted-fg: rgba(26, 26, 26, 0.65)");
    expect(result2).toContain("--pi-border: rgba(26, 26, 26, 0.20)");
  });
});
