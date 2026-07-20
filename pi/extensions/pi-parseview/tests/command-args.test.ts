import { describe, expect, it } from "vite-plus/test";
import { parseCommandLine } from "../src/command-args";

describe("ParseView command arguments", () => {
  it("keeps quoted paths with spaces together", () => {
    expect(parseCommandLine('"docs/project notes.md" --browser')).toEqual([
      "docs/project notes.md",
      "--browser",
    ]);
  });

  it("preserves Windows-style backslashes that are not escapes", () => {
    expect(parseCommandLine("C:\\work\\project notes.md")).toEqual([
      "C:\\work\\project",
      "notes.md",
    ]);
  });

  it("rejects unterminated quotes", () => {
    expect(() => parseCommandLine('"docs/project notes.md')).toThrow(/Unterminated quote/);
  });
});
