/** Zero-based source position. Columns are ast-grep/tree-sitter columns. */
export interface SourcePosition {
  readonly line: number;
  readonly column: number;
}

/** Zero-based, end-exclusive UTF-8 byte interval. */
export interface ByteRange {
  readonly start: number;
  readonly end: number;
}

/** Normalized ast-grep range. Both byte and position ends are exclusive. */
export interface SourceRange {
  readonly bytes: ByteRange;
  readonly start: SourcePosition;
  readonly end: SourcePosition;
}

export interface MetavariableCapture {
  readonly name: string;
  readonly text: string;
  readonly range?: SourceRange;
}

export interface Metavariables {
  readonly single: Readonly<Record<string, MetavariableCapture>>;
  readonly multi: Readonly<Record<string, readonly MetavariableCapture[]>>;
  readonly transformed: Readonly<Record<string, MetavariableCapture>>;
}

export type OutlineRole = "item" | "member";

export interface OutlineItem {
  readonly role: OutlineRole;
  readonly symbolType: string;
  readonly name: string;
  readonly range: SourceRange;
  readonly signature: string;
  readonly astKind: string;
  readonly isImport?: boolean;
  readonly isExported?: boolean;
  readonly isPublic?: boolean;
  readonly members: readonly OutlineItem[];
}

export interface OutlineFile {
  readonly path: string;
  readonly language: string;
  readonly items: readonly OutlineItem[];
}

export type DiagnosticSeverity = "info" | "warning" | "error";

export interface Diagnostic {
  readonly severity: DiagnosticSeverity;
  readonly message: string;
  readonly source: "ast-grep" | "configuration" | "extension";
}

export type OperationKind =
  | "probe"
  | "outline"
  | "search"
  | "inspect"
  | "rule-test"
  | "rule-discovery"
  | "codemod-preview"
  | "codemod-apply";
export type OperationOutcome = "success" | "no-match" | "test-failed" | "invalid";

export interface OperationMetadata {
  readonly kind: OperationKind;
  readonly executable: string;
  readonly argv: readonly string[];
  readonly startedAt: string;
  readonly durationMs: number;
  readonly exitCode: number;
  readonly outcome: OperationOutcome;
}

export interface OutlineResult {
  readonly files: readonly OutlineFile[];
  readonly diagnostics: readonly Diagnostic[];
  readonly operation: OperationMetadata;
}

export interface ScanLabel {
  readonly text: string;
  readonly range: SourceRange;
  readonly message?: string;
  readonly style?: string;
}

export interface SearchMatch {
  readonly text: string;
  readonly range: SourceRange;
  readonly file: string;
  readonly lines: string;
  readonly charCount: { readonly leading: number; readonly trailing: number };
  readonly language: string;
  readonly metaVariables: Metavariables;
  readonly ruleId?: string;
  readonly severity?: string;
  readonly message?: string;
  readonly note?: string;
  readonly labels?: readonly ScanLabel[];
  readonly replacement?: string;
  readonly replacementOffsets?: ByteRange;
}

export interface SearchResult {
  readonly matches: readonly SearchMatch[];
  readonly diagnostics: readonly Diagnostic[];
  readonly operation: OperationMetadata;
}

export type InspectMode = "pattern" | "ast" | "cst";

export interface InspectResult {
  readonly mode: InspectMode;
  readonly inlineCode: boolean;
  readonly queryTree: string;
  readonly matches: readonly SearchMatch[];
  readonly diagnostics: readonly Diagnostic[];
  readonly operation: OperationMetadata;
}

export type RuleFixtureExpectation = "valid" | "invalid";
export type RuleFixtureFailure = "noisy" | "missing" | "not-run";

export interface RuleFixtureResult {
  readonly expectation: RuleFixtureExpectation;
  readonly index: number;
  readonly code: string;
  readonly passed: boolean;
  readonly source: string;
  readonly failure?: RuleFixtureFailure;
}

export type RuleTestStatus = "passed" | "failed" | "invalid";

export interface RuleTestResult {
  readonly ruleId: string;
  readonly status: RuleTestStatus;
  readonly fixtures: readonly RuleFixtureResult[];
  readonly passedRuleCount: number;
  readonly failedRuleCount: number;
  readonly report: string;
  readonly diagnostics: readonly Diagnostic[];
  readonly operation: OperationMetadata;
}

export interface ProjectRule {
  readonly id: string;
  readonly severity: string;
}

export interface ProjectRuleDiscoveryResult {
  readonly rules: readonly ProjectRule[];
  readonly effectiveRuleCount: number;
  readonly skippedRuleCount: number;
  readonly diagnostics: readonly Diagnostic[];
  readonly operation: OperationMetadata;
}

export type CodemodQueryKind = "pattern" | "inline_rule" | "rule_file" | "project_rules";

export interface CodemodCandidateResult {
  readonly queryKind: CodemodQueryKind;
  readonly matches: readonly SearchMatch[];
  readonly skippedWithoutFix: number;
  readonly diagnostics: readonly Diagnostic[];
  readonly operation: OperationMetadata;
}

export interface CodemodSelector {
  readonly queryKind: CodemodQueryKind;
  readonly pattern?: string;
  readonly rewrite?: string;
  readonly language?: string;
  readonly inlineRule?: string;
  readonly ruleFile?: string;
  readonly ruleFilter?: string;
  readonly paths?: readonly string[];
  readonly globs?: readonly string[];
}

/** One exact, ephemeral replacement candidate. Nothing here authorizes apply. */
export interface CodemodPreviewEntry {
  readonly file: string;
  readonly sourceRange: SourceRange;
  readonly replacementRange: ByteRange;
  readonly before: string;
  readonly replacement: string;
  readonly context: string;
  readonly ruleId?: string;
  readonly severity?: string;
  readonly message?: string;
  readonly conflictGroup?: string;
}

export interface CodemodPreviewPage {
  readonly page: number;
  readonly pageSize: number;
  readonly totalPages: number;
  readonly totalChanges: number;
  readonly fileCount: number;
  readonly conflictGroupCount: number;
  readonly skippedWithoutFix: number;
  readonly items: readonly CodemodPreviewEntry[];
  readonly truncatedByLimits: boolean;
}

export interface CodemodPreviewResult {
  readonly queryKind: CodemodQueryKind;
  readonly selector: CodemodSelector;
  readonly preview: CodemodPreviewPage;
  readonly diagnostics: readonly Diagnostic[];
  readonly operation: OperationMetadata;
  readonly advisoryOnly: true;
}

export interface CodemodApplyResult {
  readonly kind: "codemod-apply";
  readonly sourceMutation: boolean;
  readonly queryKind: CodemodQueryKind;
  readonly projectRoot: string;
  readonly outcome: "applied" | "no-match";
  readonly stdout: string;
  readonly stderr: string;
  readonly diagnostics: readonly Diagnostic[];
  readonly operation: OperationMetadata;
  readonly subprocessCount: 1;
  readonly mutationEventEmitted: boolean;
}

/** Conservative same-root invalidation; empty paths means the whole project may have changed. */
export interface FilesMutatedEvent {
  readonly schemaVersion: 1;
  readonly source: "pi-ast-grep";
  readonly projectRoot: string;
  readonly operation: "apply";
  readonly state: "applied";
  readonly paths: readonly string[];
  readonly canonicalPaths: readonly string[];
  readonly emittedAt: string;
}

export interface AstGrepCapabilities {
  readonly available: boolean;
  readonly version?: string;
  readonly verifiedContract: boolean;
  readonly outlineJsonStream: boolean;
  readonly runJsonStream: boolean;
  readonly ruleTesting: boolean;
  readonly projectRuleDiscovery: boolean;
  readonly codemodPreview: boolean;
  readonly nativeApply: boolean;
  readonly debugQueryModes: readonly InspectMode[];
  readonly diagnostics: readonly Diagnostic[];
  readonly operation?: OperationMetadata;
}

export interface TruncationMetadata {
  readonly truncated: boolean;
  readonly totalLines: number;
  readonly outputLines: number;
  readonly totalBytes: number;
  readonly outputBytes: number;
  readonly maxLines: number;
  readonly maxBytes: number;
}

export interface SpoolMetadata {
  readonly path: string;
  readonly private: true;
  readonly bytes: number;
}

export interface BoundedOutput {
  readonly text: string;
  readonly truncation: TruncationMetadata;
  readonly spool?: SpoolMetadata;
}
