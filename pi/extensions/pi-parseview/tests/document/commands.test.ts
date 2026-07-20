import { describe, expect, it } from "vite-plus/test";
import { parseLegacyCommandArgs } from "../../src/document/index";

describe("/parse command arguments", () => {
  it("accepts quoted paths with spaces and normalizes one leading @", () => {
    expect(parseLegacyCommandArgs('"@docs/project notes.pdf" --pages "1-2" --no-ocr')).toEqual({
      path: "docs/project notes.pdf",
      targetPages: "1-2",
      ocrMode: "off",
    });
  });
});
