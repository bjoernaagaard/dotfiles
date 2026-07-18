import { Text } from "@earendil-works/pi-tui";
import { truncateUtf8WithEllipsis } from "./utils";

type ThemeLike = {
  fg?: (color: any, text: string) => string;
  bold?: (text: string) => string;
};

function color(theme: ThemeLike, name: string, text: string): string {
  return typeof theme?.fg === "function" ? theme.fg(name, text) : text;
}

function bold(theme: ThemeLike, text: string): string {
  return typeof theme?.bold === "function" ? theme.bold(text) : text;
}

function textComponent(text: string): Text {
  return new Text(text, 0, 0);
}

function renderPartial(theme: ThemeLike, label: string, phase?: string): Text {
  const message = `${label}: ${truncateUtf8WithEllipsis(phase ?? "working…", 120).text}`;
  return textComponent(color(theme, "warning", message));
}

function renderError(theme: ThemeLike, label: string, error: unknown): Text {
  const message = error instanceof Error ? error.message : String(error);
  return textComponent(
    color(theme, "error", `${label} error: ${truncateUtf8WithEllipsis(message, 240).text}`),
  );
}

export function renderParseCall(args: any, theme: ThemeLike, _context: any): Text {
  const bits = ["parse_document", args?.path ? args.path : "<path>"];
  if (args?.format) bits.push(`format=${args.format}`);
  if (args?.ocrMode) bits.push(`ocr=${args.ocrMode}`);
  if (args?.useOcr !== undefined) bits.push(`useOcr=${args.useOcr}`);
  const [name, ...rest] = bits;
  return textComponent(
    `${color(theme, "toolTitle", bold(theme, name))} ${color(theme, "muted", rest.join(" "))}`,
  );
}

export function renderParseResult(
  result: any,
  options: { expanded: boolean; isPartial: boolean },
  theme: ThemeLike,
  _context: any,
): Text {
  if (options.isPartial) {
    return renderPartial(theme, "parse", result?.details?.phase ?? result?.details?.status);
  }
  if (result?.details?.error) return renderError(theme, "parse", result.details.error);

  const details = result?.details ?? {};
  const summary = [
    `doc=${details.documentId ?? "?"}`,
    `pages=${details.pageCount ?? "?"}`,
    `cache=${details.cacheHit ? "hit" : "miss"}`,
    `ocr=${details.ocrModeResolved ?? "?"}`,
  ];
  const lines = [`parse_document ${summary.join(" ")}`];
  if (options.expanded) {
    if (details.source) lines.push(`source=${details.source}`);
    if (details.format) lines.push(`format=${details.format}`);
    if (Array.isArray(details.artifactPaths)) {
      lines.push(`artifacts=${details.artifactPaths.slice(0, 8).join(",")}`);
    }
  }
  return textComponent(color(theme, "success", lines.join("\n")));
}

export function renderQueryCall(args: any, theme: ThemeLike, _context: any): Text {
  const suffix = `${args?.documentId ?? "<documentId>"} action=${args?.action ?? "?"}`;
  return textComponent(
    `${color(theme, "toolTitle", bold(theme, "query_document"))} ${color(theme, "muted", suffix)}`,
  );
}

export function renderQueryResult(
  result: any,
  options: { expanded: boolean; isPartial: boolean },
  theme: ThemeLike,
  _context: any,
): Text {
  if (options.isPartial) {
    return renderPartial(theme, "query", result?.details?.phase ?? result?.details?.status);
  }
  if (result?.details?.error) return renderError(theme, "query", result.details.error);

  const details = result?.details ?? {};
  const count = details.matchCount ?? details.lineCount ?? 0;
  const lines = [`query_document ${details.action ?? "read"} ${count} item(s)`];
  if (options.expanded) {
    if (details.documentId) lines.push(`doc=${details.documentId}`);
    if (details.matchCount !== undefined) lines.push(`matches=${details.matchCount}`);
    if (details.truncated) lines.push("truncated=yes");
    if (details.continuationStartLine) lines.push(`continue=${details.continuationStartLine}`);
    if (details.fullOutputPath) lines.push(`full=${details.fullOutputPath}`);
  }
  return textComponent(color(theme, "success", lines.join("\n")));
}

export function renderScreenshotCall(args: any, theme: ThemeLike, _context: any): Text {
  const pages = Array.isArray(args?.pages) ? args.pages.join(",") : "?";
  const suffix = `${args?.documentId ?? "<documentId>"} pages=${pages}${args?.dpi ? ` dpi=${args.dpi}` : ""}`;
  return textComponent(
    `${color(theme, "toolTitle", bold(theme, "screenshot_document"))} ${color(theme, "muted", suffix)}`,
  );
}

export function renderScreenshotResult(
  result: any,
  options: { expanded: boolean; isPartial: boolean },
  theme: ThemeLike,
  _context: any,
): Text {
  if (options.isPartial) {
    return renderPartial(theme, "screenshot", result?.details?.phase ?? result?.details?.status);
  }
  if (result?.details?.error) return renderError(theme, "screenshot", result.details.error);

  const details = result?.details ?? {};
  const lines = [`screenshot_document ${details.pageCount ?? 0} page(s)`];
  if (options.expanded && Array.isArray(details.pages)) {
    lines.push(...details.pages.map((page: any) => `${page.pageNum}: ${page.path}`));
    if (details.truncated) lines.push("truncated=yes");
    if (details.fullOutputPath) lines.push(`full=${details.fullOutputPath}`);
  }
  return textComponent(color(theme, "success", lines.join("\n")));
}
