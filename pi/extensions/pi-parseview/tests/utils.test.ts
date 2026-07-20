import { describe, it, expect } from "vite-plus/test";
import { detectMermaidDiagramKind, normalizeMermaidCode, rewriteImagePaths } from "../src/utils";

describe("normalizeMermaidCode", () => {
  it("converts semicolons to newlines", () => {
    const input = "graph TD; A-->B; C-->D";
    const result = normalizeMermaidCode(input);
    expect(result).toBe("graph TD\nA-->B\nC-->D");
  });

  it("handles code without semicolons unchanged", () => {
    const input = "graph TD\nA-->B";
    expect(normalizeMermaidCode(input)).toBe(input);
  });

  it("handles semicolons with trailing whitespace without creating blank lines", () => {
    const input = "graph TD;   A-->B;  \nC-->D";
    const result = normalizeMermaidCode(input);
    expect(result).toBe("graph TD\nA-->B\nC-->D");
  });

  it("handles input already containing newlines and semicolons mixed", () => {
    const input = "graph TD\nA[Start] --> B{Go?}; B -->|Yes| C[End]";
    const result = normalizeMermaidCode(input);
    expect(result).toBe("graph TD\nA[Start] --> B{Go?}\nB -->|Yes| C[End]");
  });

  it("handles empty string", () => {
    expect(normalizeMermaidCode("")).toBe("");
  });

  it("handles edge cases like standalone semicolons", () => {
    expect(normalizeMermaidCode("graph LR\nA; B; C")).toBe("graph LR\nA\nB\nC");
  });

  it("does not double-normalize (idempotent)", () => {
    const input = "graph LR\nA --> B\nB --> C";
    expect(normalizeMermaidCode(normalizeMermaidCode(input))).toBe(input);
  });

  it("preserves semicolons inside quoted labels and messages", () => {
    expect(normalizeMermaidCode('graph TD; A["Start; Keep"] --> B')).toBe(
      'graph TD\nA["Start; Keep"] --> B',
    );
    expect(normalizeMermaidCode('sequenceDiagram; Alice->>Bob: "hello; keep"')).toBe(
      'sequenceDiagram\nAlice->>Bob: "hello; keep"',
    );
  });

  it("strips leading comments and init directives before dispatch", () => {
    const input = '%% comment\n%%{init: {"theme":"forest"}}%%\nsequenceDiagram\nA->>B: hello';
    expect(normalizeMermaidCode(input)).toBe("sequenceDiagram\nA->>B: hello");
  });
});

describe("detectMermaidDiagramKind", () => {
  it.each([
    ["graph TD", "flowchart"],
    ["stateDiagram-v2", "state"],
    ["sequenceDiagram", "sequence"],
    ["classDiagram", "class"],
    ["erDiagram", "er"],
    ["xychart-beta", "xychart"],
  ] as const)("recognizes %s", (header, expected) => {
    expect(detectMermaidDiagramKind(header)).toBe(expected);
  });

  it("fails clearly for unsupported headers", () => {
    expect(() => detectMermaidDiagramKind("gantt\ntitle Work")).toThrow(
      /Unsupported Mermaid diagram header/,
    );
  });
});

describe("rewriteImagePaths", () => {
  it("rewrites placeholder image paths to absolute paths", () => {
    const input = "![](image_p1_0.png)\n\nSome text\n\n![](image_p2_0.png)";
    const result = rewriteImagePaths(input, "/tmp/images/abc123");
    expect(result).toBe(
      "![](/tmp/images/abc123/image_p1_0.png)\n\nSome text\n\n![](/tmp/images/abc123/image_p2_0.png)",
    );
  });

  it("handles markdown with no images", () => {
    const input = "Just plain text\n\nWith **bold** and lists.";
    expect(rewriteImagePaths(input, "/tmp/images/x")).toBe(input);
  });

  it("handles empty string", () => {
    expect(rewriteImagePaths("", "/tmp/img")).toBe("");
  });

  it("rewrites multiple images on the same line", () => {
    const input = "![](image_p1.png) middle ![](image_p2.png)";
    const result = rewriteImagePaths(input, "/tmp/dir");
    expect(result).toBe("![](/tmp/dir/image_p1.png) middle ![](/tmp/dir/image_p2.png)");
  });

  it("preserves non-image markdown content around images", () => {
    const input =
      "# Header\n\n![](image_p1.png)\n\nSome text\n\n> ![](image_p2.png)\n\n```\ncode\n```";
    const result = rewriteImagePaths(input, "/img");
    expect(result).toContain("# Header");
    expect(result).toContain("Some text");
    expect(result).toContain("code");
    expect(result).toContain("![](/img/image_p1.png)");
    expect(result).toContain("![](/img/image_p2.png)");
  });
});
