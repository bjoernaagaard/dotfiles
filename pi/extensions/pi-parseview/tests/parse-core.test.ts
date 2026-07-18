import { describe, it, expect, beforeEach } from "vite-plus/test";
import {
  parseDocument,
  setLiteparseAvailable,
  isLiteparseAvailable,
} from "../src/parser/parse-core";

describe("parseDocument", () => {
  beforeEach(() => {
    setLiteparseAvailable(true);
  });

  it("rejects non-existent files with clear error", async () => {
    await expect(parseDocument("/nonexistent/path.pdf", undefined, true)).rejects.toThrow(
      /not found|ENOENT/i,
    );
  });

  it("rejects empty path", async () => {
    await expect(parseDocument("", undefined, true)).rejects.toThrow(/path/i);
  });

  it("throws user-friendly error when liteparse is unavailable", async () => {
    setLiteparseAvailable(false);
    await expect(parseDocument("/some/file.pdf", undefined, true)).rejects.toThrow(
      /liteparse native module/i,
    );
  });

  it("isLiteparseAvailable and setLiteparseAvailable round-trip", () => {
    expect(isLiteparseAvailable()).toBe(true);
    setLiteparseAvailable(false);
    expect(isLiteparseAvailable()).toBe(false);
    setLiteparseAvailable(true);
    expect(isLiteparseAvailable()).toBe(true);
  });
});
