import { describe, it, expect } from "vite-plus/test";
import { detectMermaidTheme } from "../src/theme";

describe("detectMermaidTheme", () => {
  it("returns tokyo-night for pi theme containing 'tokyo-night'", () => {
    const result = detectMermaidTheme("tokyo-night");
    expect(result.bg).toBe("#1a1b26");
    expect(result.fg).toBe("#a9b1d6");
    expect(result.accent).toBe("#7aa2f7");
  });

  it("matches case-insensitively on partial pi theme names", () => {
    const result = detectMermaidTheme("My Custom Tokyo-Night Variant");
    expect(result.bg).toBe("#1a1b26");
  });

  it("returns catppuccin-mocha for pi theme containing 'mocha'", () => {
    const result = detectMermaidTheme("catppuccin-mocha");
    expect(result.bg).toBe("#1e1e2e");
    expect(result.fg).toBe("#cdd6f4");
  });

  it("returns one-dark as fallback dark theme when bg is dark", () => {
    const result = detectMermaidTheme(undefined, "#111111", "#eeeeee");
    expect(result.bg).toBe("#282c34");
  });

  it("returns github-light as fallback light theme when bg is light", () => {
    const result = detectMermaidTheme(undefined, "#ffffff", "#000000");
    expect(result.bg).toBe("#ffffff");
    expect(result.fg).toBe("#1f2328");
  });

  it("returns tokyo-night as default when no theme info available", () => {
    const result = detectMermaidTheme();
    expect(result.bg).toBe("#1a1b26");
  });

  it("handles nord theme", () => {
    const result = detectMermaidTheme("nord");
    expect(result.bg).toBe("#2e3440");
    expect(result.fg).toBe("#d8dee9");
  });

  it("handles dracula theme", () => {
    const result = detectMermaidTheme("dracula");
    expect(result.bg).toBe("#282a36");
    expect(result.fg).toBe("#f8f8f2");
  });
});
