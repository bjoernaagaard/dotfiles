import { describe, expect, it } from "vite-plus/test";
import { formatParseViewStatus, PARSEVIEW_STATUS_KEY, setParseViewStatus } from "../src/status";

describe("parseview footer status", () => {
  it("summarizes parser and browser availability compactly", () => {
    expect(formatParseViewStatus({ parser: true, browser: true })).toBe(
      "📄 PV parse ready web ready",
    );
    expect(formatParseViewStatus({ parser: false, browser: true })).toBe(
      "📄 PV parse missing web ready",
    );
  });

  it("publishes only its own composable status key", () => {
    const calls: Array<[string, string | undefined]> = [];
    const ctx = {
      hasUI: true,
      ui: { setStatus: (key: string, value: string | undefined) => calls.push([key, value]) },
    } as any;

    setParseViewStatus(ctx, { parser: true, browser: false });
    setParseViewStatus(ctx, undefined);

    expect(calls).toEqual([
      [PARSEVIEW_STATUS_KEY, "📄 PV parse ready web missing"],
      [PARSEVIEW_STATUS_KEY, undefined],
    ]);
  });
});
