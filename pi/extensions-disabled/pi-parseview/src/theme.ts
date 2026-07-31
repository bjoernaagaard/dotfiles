import { THEMES as BM_THEMES, type DiagramColors } from "beautiful-mermaid";

const THEME_MAP: Record<string, string> = {
  "tokyo-night": "tokyo-night",
  "tokyo-night-storm": "tokyo-night-storm",
  "tokyo-night-light": "tokyo-night-light",
  "catppuccin-mocha": "catppuccin-mocha",
  "catppuccin-latte": "catppuccin-latte",
  nord: "nord",
  "nord-light": "nord-light",
  dracula: "dracula",
  "github-light": "github-light",
  "github-dark": "github-dark",
  "solarized-light": "solarized-light",
  "solarized-dark": "solarized-dark",
  "one-dark": "one-dark",
  "zinc-light": "zinc-light",
  "zinc-dark": "zinc-dark",
};

function inferTheme(bgHex: string, _fgHex: string): string {
  // Rough luminance check: if bg is dark, use a dark fallback
  const bgInt = parseInt(bgHex.replace("#", ""), 16);
  const r = (bgInt >> 16) & 0xff;
  const g = (bgInt >> 8) & 0xff;
  const b = bgInt & 0xff;
  const luminance = 0.299 * r + 0.587 * g + 0.114 * b;
  return luminance < 128 ? "one-dark" : "github-light";
}

export function detectMermaidTheme(
  piThemeName?: string,
  bgColor?: string,
  fgColor?: string,
): DiagramColors {
  // Prefer exact names, then the most specific partial match. This keeps
  // `tokyo-night-storm` from being captured by `tokyo-night`, and similarly
  // preserves `nord-light`.
  if (piThemeName) {
    const lower = piThemeName.toLowerCase().trim();
    const candidates = Object.entries(THEME_MAP).sort(([a], [b]) => b.length - a.length);
    for (const [key, bmName] of candidates) {
      if (lower === key) {
        return BM_THEMES[bmName as keyof typeof BM_THEMES];
      }
    }
    for (const [key, bmName] of candidates) {
      if (lower.includes(key)) {
        return BM_THEMES[bmName as keyof typeof BM_THEMES];
      }
    }
  }

  // Fall back to the closest built-in light/dark palette when callers can
  // provide terminal colors but no recognized named theme.
  if (bgColor && fgColor) {
    const inferred = inferTheme(bgColor, fgColor);
    return BM_THEMES[inferred as keyof typeof BM_THEMES];
  }

  return BM_THEMES["tokyo-night"];
}

export { BM_THEMES };
