import { describe, it, expect, beforeEach } from "vite-plus/test";
import { isBrowserAvailable, setBrowserAvailable, getSharedBrowser } from "../src/browser";
import { resetConfig } from "../src/config";

describe("browser availability", () => {
  beforeEach(() => {
    setBrowserAvailable(true);
    resetConfig();
  });

  it("getSharedBrowser throws user-friendly error when browser unavailable", async () => {
    setBrowserAvailable(false);
    await expect(getSharedBrowser()).rejects.toThrow(/No Chromium browser found/i);
  });

  it("setBrowserAvailable and isBrowserAvailable round-trip", () => {
    setBrowserAvailable(false);
    expect(isBrowserAvailable()).toBe(false);
    setBrowserAvailable(true);
    expect(isBrowserAvailable()).toBe(true);
  });
});
