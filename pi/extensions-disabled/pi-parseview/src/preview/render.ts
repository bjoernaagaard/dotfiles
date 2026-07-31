import { marked } from "marked";
import markedKatex from "marked-katex-extension";
import { loadConfig } from "../config";

// Register KaTeX extension once at module load
marked.use(markedKatex({ throwOnError: false }));

export interface ThemeColors {
  bg: string;
  fg: string;
}

export async function renderMarkdown(markdown: string): Promise<string> {
  return marked.parse(markdown);
}

export function wrapWithTheme(htmlBody: string, colors: ThemeColors, fontSize?: number): string {
  const fs = fontSize ?? loadConfig().fontSize;
  const { bg, fg } = colors;

  // Parse hex colors to RGB for alpha blending
  const hexToRgb = (hex: string): { r: number; g: number; b: number } | null => {
    const clean = hex.replace("#", "");
    if (clean.length !== 6) return null;
    const num = parseInt(clean, 16);
    return { r: (num >> 16) & 0xff, g: (num >> 8) & 0xff, b: num & 0xff };
  };

  const fgRgb = hexToRgb(fg);
  const bgRgb = hexToRgb(bg);

  // Derive muted-fg at 65% opacity, border at 20% opacity
  const mutedFg = fgRgb ? `rgba(${fgRgb.r}, ${fgRgb.g}, ${fgRgb.b}, 0.65)` : fg;
  const borderColor = fgRgb ? `rgba(${fgRgb.r}, ${fgRgb.g}, ${fgRgb.b}, 0.20)` : fg;

  // Derive code-bg as slightly lighter bg
  const codeBg = bgRgb
    ? `rgb(${Math.min(255, bgRgb.r + 15)}, ${Math.min(255, bgRgb.g + 15)}, ${Math.min(255, bgRgb.b + 15)})`
    : bg;

  return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<style>
  :root {
    --pi-bg: ${bg};
    --pi-fg: ${fg};
    --pi-muted-fg: ${mutedFg};
    --pi-border: ${borderColor};
    --pi-code-bg: ${codeBg};
  }
  body {
    background: var(--pi-bg);
    color: var(--pi-fg);
    font-size: ${fs}px;
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif;
    line-height: 1.5;
    padding: 1.25em;
    max-width: 36em;
    margin: 0 auto;
  }
  code { background: var(--pi-code-bg); padding: 0.15em 0.3em; border-radius: 3px; }
  pre code { background: none; padding: 0; }
  img { max-width: 100%; }
  table { border-collapse: collapse; width: 100%; }
  th, td { border: 1px solid var(--pi-border); padding: 0.5em; }
  blockquote { border-left: 3px solid var(--pi-border); margin: 0; padding-left: 1em; }
  .katex-display { overflow-x: auto; overflow-y: hidden; }
</style>
</head>
<body>${htmlBody}</body>
</html>`;
}
