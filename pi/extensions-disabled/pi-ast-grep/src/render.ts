import type {
  CodemodApplyResult,
  CodemodPreviewResult,
  Diagnostic,
  InspectResult,
  OutlineItem,
  OutlineResult,
  ProjectRuleDiscoveryResult,
  RuleTestResult,
  SearchResult,
} from "./domain.js";

export function countOutlineSymbols(result: OutlineResult): number {
  const count = (items: readonly OutlineItem[]): number => items.reduce((sum, item) => sum + 1 + count(item.members), 0);
  return result.files.reduce((sum, file) => sum + count(file.items), 0);
}

export function summarizeOutline(result: OutlineResult): string {
  return `${result.files.length} file${result.files.length === 1 ? "" : "s"}, ${countOutlineSymbols(result)} symbol${countOutlineSymbols(result) === 1 ? "" : "s"}`;
}

export function summarizeSearch(result: SearchResult): string {
  const files = new Set(result.matches.map((match) => match.file)).size;
  return `${result.matches.length} match${result.matches.length === 1 ? "" : "es"} in ${files} file${files === 1 ? "" : "s"}`;
}

export function summarizeInspect(result: InspectResult): string {
  return `${result.mode} query, ${result.matches.length} match${result.matches.length === 1 ? "" : "es"}`;
}

export function summarizeRuleTest(result: RuleTestResult): string {
  const passed = result.fixtures.filter((fixture) => fixture.passed).length;
  return `${result.ruleId}: ${result.status}, ${passed}/${result.fixtures.length} fixtures passed`;
}

export function summarizeProjectRules(result: ProjectRuleDiscoveryResult): string {
  return `${result.rules.length} effective rule${result.rules.length === 1 ? "" : "s"}, ${result.skippedRuleCount} skipped`;
}

export function summarizeCodemodPreview(result: CodemodPreviewResult): string {
  const preview = result.preview;
  if (preview.totalChanges === 0) return `no actionable replacements, ${preview.skippedWithoutFix} finding${preview.skippedWithoutFix === 1 ? "" : "s"} without fixes`;
  const conflicts = preview.conflictGroupCount === 0 ? "" : `, ${preview.conflictGroupCount} conflict group${preview.conflictGroupCount === 1 ? "" : "s"}`;
  return `${preview.totalChanges} change${preview.totalChanges === 1 ? "" : "s"} in ${preview.fileCount} file${preview.fileCount === 1 ? "" : "s"}${conflicts} · page ${preview.page}/${preview.totalPages}`;
}

export function summarizeCodemodApply(result: CodemodApplyResult): string {
  return result.outcome === "applied"
    ? `native -U apply completed in one process (${result.operation.durationMs}ms)`
    : `native -U found no replacements (${result.operation.durationMs}ms)`;
}

export function diagnosticSuffix(diagnostics: readonly Diagnostic[], truncated: boolean): string {
  const parts: string[] = [];
  if (diagnostics.length > 0) parts.push(`${diagnostics.length} diagnostic${diagnostics.length === 1 ? "" : "s"}`);
  if (truncated) parts.push("truncated");
  return parts.length === 0 ? "" : ` (${parts.join(", ")})`;
}

/** Keep expanded TUI rendering small even when model-facing output has a larger bound. */
export function boundedRendererText(text: string, maxLines = 30, maxChars = 12_000): string {
  const sourceLines = text.split("\n");
  const lines = sourceLines.slice(0, maxLines);
  let output = lines.join("\n");
  let omitted = sourceLines.length > maxLines;
  if (output.length > maxChars) {
    output = output.slice(0, maxChars);
    omitted = true;
  }
  return omitted ? `${output}\n… (expanded view bounded)` : output;
}
