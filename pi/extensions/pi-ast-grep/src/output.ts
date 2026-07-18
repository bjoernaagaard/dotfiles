import { chmod, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  DEFAULT_MAX_BYTES,
  DEFAULT_MAX_LINES,
  formatSize,
  truncateHead,
  withFileMutationQueue,
} from "@earendil-works/pi-coding-agent";
import type {
  BoundedOutput,
  CodemodApplyResult,
  CodemodPreviewResult,
  InspectResult,
  OutlineItem,
  OutlineResult,
  ProjectRuleDiscoveryResult,
  RuleTestResult,
  SearchMatch,
  SearchResult,
} from "./domain.js";

export interface BoundOutputOptions {
  readonly maxLines?: number;
  readonly maxBytes?: number;
  readonly spoolPrefix?: string;
  /** Disable for ephemeral previews whose exact pre-images must not be persisted. */
  readonly spoolOnTruncate?: boolean;
}

/**
 * Bound human-readable text for model context. If truncated, preserve the exact
 * complete text in a mode-0600 file under a mode-0700 temporary directory.
 */
export async function boundOutput(fullText: string, options: BoundOutputOptions = {}): Promise<BoundedOutput> {
  const maxLines = options.maxLines ?? DEFAULT_MAX_LINES;
  const maxBytes = options.maxBytes ?? DEFAULT_MAX_BYTES;
  assertPositiveInteger(maxLines, "maxLines");
  assertPositiveInteger(maxBytes, "maxBytes");

  const result = truncateHead(fullText, { maxLines, maxBytes });
  const truncation = {
    truncated: result.truncated,
    totalLines: result.totalLines,
    outputLines: result.outputLines,
    totalBytes: result.totalBytes,
    outputBytes: result.outputBytes,
    maxLines: result.maxLines,
    maxBytes: result.maxBytes,
  };
  if (!result.truncated) return { text: result.content, truncation };
  if (options.spoolOnTruncate === false) {
    const notice = `[Output truncated without persistence: showing ${result.outputLines} of ${result.totalLines} lines (${formatSize(result.outputBytes)} of ${formatSize(result.totalBytes)}). Request another bounded page.]`;
    return { text: result.content === "" ? notice : `${result.content}\n\n${notice}`, truncation };
  }

  const prefix = safePrefix(options.spoolPrefix ?? "pi-ast-grep-");
  const directory = await mkdtemp(join(tmpdir(), prefix));
  await chmod(directory, 0o700);
  const path = join(directory, "output.txt");
  await withFileMutationQueue(path, async () => {
    await writeFile(path, fullText, { encoding: "utf8", mode: 0o600, flag: "wx" });
    await chmod(path, 0o600);
  });

  const omittedLines = result.totalLines - result.outputLines;
  const omittedBytes = result.totalBytes - result.outputBytes;
  const notice = `[Output truncated: showing ${result.outputLines} of ${result.totalLines} lines `
    + `(${formatSize(result.outputBytes)} of ${formatSize(result.totalBytes)}); `
    + `${omittedLines} lines (${formatSize(omittedBytes)}) omitted. Full output: ${path}]`;
  return {
    text: result.content === "" ? notice : `${result.content}\n\n${notice}`,
    truncation,
    spool: { path, private: true, bytes: result.totalBytes },
  };
}

export function formatOutline(result: OutlineResult): string {
  if (result.files.length === 0) return "No outline entries found.";
  const lines: string[] = [];
  for (const file of result.files) {
    lines.push(`${file.path} (${file.language})`);
    for (const item of file.items) appendOutlineItem(lines, item, 1);
  }
  return lines.join("\n");
}

export function formatSearch(result: SearchResult): string {
  if (result.matches.length === 0) return "No matches found.";
  return result.matches.map(formatMatch).join("\n\n");
}

export function formatInspect(result: InspectResult): string {
  const matches = result.matches.length === 0
    ? "No matches found."
    : result.matches.map(formatMatch).join("\n\n");
  return `Query (${result.mode}):\n${result.queryTree || "(no query tree)"}\n\n${matches}`;
}

export function formatRuleTest(result: RuleTestResult): string {
  const lines = [
    `Rule ${result.ruleId}: ${result.status}`,
    `${result.fixtures.filter((fixture) => fixture.passed).length}/${result.fixtures.length} fixtures passed`,
  ];
  for (const fixture of result.fixtures) {
    const label = `${fixture.expectation}[${fixture.index}]`;
    if (fixture.passed) {
      lines.push(`PASS ${label}`);
      continue;
    }
    const reason = fixture.failure === "noisy"
      ? "unexpected finding in valid fixture"
      : fixture.failure === "missing"
        ? "expected finding missing from invalid fixture"
        : "fixture was not run because the rule/configuration was invalid";
    lines.push(`FAIL ${label}: ${reason}\n${fixture.source}`);
  }
  if (result.report !== "") lines.push(`ast-grep report:\n${result.report}`);
  return lines.join("\n\n");
}

export function formatProjectRules(result: ProjectRuleDiscoveryResult): string {
  if (result.rules.length === 0) {
    return `No effective project rules found. ${result.skippedRuleCount} rule${result.skippedRuleCount === 1 ? "" : "s"} skipped.`;
  }
  const lines = result.rules.map((rule) => `${rule.id} (${rule.severity})`);
  if (result.skippedRuleCount > 0) lines.push(`Skipped rules: ${result.skippedRuleCount}`);
  return lines.join("\n");
}

export function formatCodemodPreview(result: CodemodPreviewResult): string {
  const preview = result.preview;
  if (preview.totalChanges === 0) {
    return `No actionable replacements found.${preview.skippedWithoutFix === 0 ? "" : ` ${preview.skippedWithoutFix} finding(s) had no fix.`}`;
  }
  const lines = [
    `Advisory preview page ${preview.page}/${preview.totalPages}`,
    `${preview.totalChanges} exact replacement(s) in ${preview.fileCount} file(s)`,
    "Apply reruns this selector against current source; this preview is not an approval or snapshot.",
  ];
  if (preview.conflictGroupCount > 0) lines.push(`Overlapping replacement groups: ${preview.conflictGroupCount}`);
  if (preview.skippedWithoutFix > 0) lines.push(`Findings without fixes skipped: ${preview.skippedWithoutFix}`);
  for (const [index, item] of preview.items.entries()) {
    const ordinal = (preview.page - 1) * preview.pageSize + index + 1;
    const start = `${item.sourceRange.start.line + 1}:${item.sourceRange.start.column + 1}`;
    const end = `${item.sourceRange.end.line + 1}:${item.sourceRange.end.column + 1}`;
    const metadata = [
      item.ruleId && `rule=${item.ruleId}`,
      item.severity && `severity=${item.severity}`,
      item.message && `message=${JSON.stringify(item.message)}`,
      item.conflictGroup && `conflict=${item.conflictGroup}`,
    ].filter(Boolean).join(" ");
    lines.push([
      `\n[${ordinal}/${preview.totalChanges}] ${item.file}:${start}-${end}`,
      `replacement-bytes=${item.replacementRange.start}-${item.replacementRange.end}${metadata ? ` ${metadata}` : ""}`,
      "Context:",
      item.context,
      `Before (${Buffer.byteLength(item.before)} bytes):`,
      item.before,
      `Replacement (${Buffer.byteLength(item.replacement)} bytes):`,
      item.replacement,
    ].join("\n"));
  }
  if (preview.page < preview.totalPages) lines.push(`Next page: page=${preview.page + 1}, pageSize=${preview.pageSize}`);
  return lines.join("\n");
}

export function formatCodemodApply(result: CodemodApplyResult): string {
  const heading = result.outcome === "applied"
    ? "Native ast-grep -U apply completed in one subprocess."
    : "Native ast-grep -U found no replacements; source was not changed.";
  const processOutput = [result.stdout.trim(), result.stderr.trim()].filter(Boolean).join("\n\n");
  return processOutput === "" ? heading : `${heading}\n\n${processOutput}`;
}

function formatMatch(match: SearchMatch): string {
  const { start, end } = match.range;
  const location = `${match.file}:${start.line + 1}:${start.column + 1}-${end.line + 1}:${end.column + 1}`;
  const metavariables = formatMetaVariables(match.metaVariables);
  const finding = [match.ruleId, match.severity, match.message].filter(Boolean).join(" · ");
  const preview = match.replacement === undefined
    ? ""
    : `\nRead-only replacement preview @ bytes ${match.replacementOffsets?.start ?? "?"}-${match.replacementOffsets?.end ?? "?"}: ${JSON.stringify(match.replacement)}`;
  return `${location} [${match.language}]${finding ? ` ${finding}` : ""}${metavariables ? ` ${metavariables}` : ""}\n${match.lines}${preview}`;
}

/** Format single ($NAME), multi ($$$NAME), and transformed captures for model-facing text. */
function formatMetaVariables(meta: SearchMatch["metaVariables"]): string {
  const parts: string[] = [];
  for (const name of Object.keys(meta.single).sort()) {
    const capture = meta.single[name]!;
    parts.push(`$${capture.name}=${JSON.stringify(capture.text)}`);
  }
  for (const name of Object.keys(meta.multi).sort()) {
    const captures = meta.multi[name]!;
    const texts = captures.map((capture) => capture.text);
    parts.push(`$$$${name}=${JSON.stringify(texts)}`);
  }
  for (const name of Object.keys(meta.transformed).sort()) {
    const capture = meta.transformed[name]!;
    parts.push(`transformed:${capture.name}=${JSON.stringify(capture.text)}`);
  }
  return parts.join(", ");
}

function appendOutlineItem(lines: string[], item: OutlineItem, depth: number): void {
  const position = `${item.range.start.line + 1}:${item.range.start.column + 1}`;
  lines.push(`${"  ".repeat(depth)}${item.symbolType} ${item.name} @ ${position} — ${item.signature}`);
  for (const member of item.members) appendOutlineItem(lines, member, depth + 1);
}

function safePrefix(value: string): string {
  const safe = value.replace(/[^a-zA-Z0-9_-]/gu, "-");
  return safe.length === 0 ? "pi-ast-grep-" : safe.slice(0, 48);
}

function assertPositiveInteger(value: number, name: string): void {
  if (!Number.isInteger(value) || value < 1) throw new RangeError(`${name} must be a positive integer`);
}
