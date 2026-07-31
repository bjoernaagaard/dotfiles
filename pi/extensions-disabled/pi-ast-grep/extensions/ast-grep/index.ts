import { StringEnum } from "@earendil-works/pi-ai";
import {
  DynamicBorder,
  getAgentDir,
  type ExtensionAPI,
  type ExtensionCommandContext,
  type ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import { Container, type SelectItem, SelectList, Text } from "@earendil-works/pi-tui";
import { Type } from "typebox";
import {
  AstGrepClient,
  type CodemodPreviewInput,
  type InspectInput,
  type OutlineInput,
  type ProjectRuleDiscoveryInput,
  type RuleTestInput,
  type SearchInput,
} from "../../src/ast-grep/client.js";
import { PiExecAdapter } from "../../src/ast-grep/pi-exec.js";
import { createFilesMutatedEvent, FILES_MUTATED_EVENT } from "../../src/codemod/events.js";
import { createEphemeralPreview } from "../../src/codemod/preview.js";
import { loadConfig, type AstGrepConfig } from "../../src/config.js";
import type {
  BoundedOutput,
  CodemodApplyResult,
  CodemodPreviewResult,
  CodemodSelector,
  InspectResult,
  OutlineResult,
  ProjectRuleDiscoveryResult,
  RuleTestResult,
  SearchResult,
} from "../../src/domain.js";
import {
  boundOutput,
  formatCodemodApply,
  formatCodemodPreview,
  formatInspect,
  formatOutline,
  formatProjectRules,
  formatRuleTest,
  formatSearch,
} from "../../src/output.js";
import { PhaseProfiler } from "../../src/profile.js";
import {
  boundedRendererText,
  diagnosticSuffix,
  summarizeCodemodApply,
  summarizeCodemodPreview,
  summarizeInspect,
  summarizeOutline,
  summarizeProjectRules,
  summarizeRuleTest,
  summarizeSearch,
} from "../../src/render.js";
import { setAstGrepStatus } from "../../src/status.js";

const Paths = Type.Optional(Type.Array(Type.String({ minLength: 1 }), { description: "Project-relative files or directories" }));
const Globs = Type.Optional(Type.Array(Type.String({ minLength: 1 }), { description: "Repeatable gitignore-style include/exclude globs" }));
const QueryKind = StringEnum(["pattern", "inline_rule", "rule_file", "project_rules"] as const);

const SelectorProperties = {
  queryKind: QueryKind,
  pattern: Type.Optional(Type.String({ minLength: 1 })),
  rewrite: Type.Optional(Type.String({ minLength: 1, description: "Pattern rewrite template; valid only for pattern selectors" })),
  language: Type.Optional(Type.String({ minLength: 1 })),
  inlineRule: Type.Optional(Type.String({ minLength: 1, description: "Inline YAML rule containing a fix" })),
  ruleFile: Type.Optional(Type.String({ minLength: 1, description: "Project-relative YAML rule file containing a fix" })),
  ruleFilter: Type.Optional(Type.String({ minLength: 1, description: "Rule-id regex for configured project rules" })),
  paths: Paths,
  globs: Globs,
};

const OutlineParams = Type.Object({
  paths: Paths,
  language: Type.Optional(Type.String({ minLength: 1 })),
  items: Type.Optional(StringEnum(["auto", "structure", "exports", "imports", "all"] as const)),
  view: Type.Optional(StringEnum(["auto", "names", "signatures", "digest", "expanded"] as const)),
  match: Type.Optional(Type.String({ minLength: 1, description: "Regex matched against top-level item names and signatures" })),
  types: Type.Optional(Type.Array(Type.String({ minLength: 1 }), { description: "Top-level symbol types, such as class or function" })),
  publicMembers: Type.Optional(Type.Boolean()),
  globs: Globs,
  follow: Type.Optional(Type.Boolean({ description: "Follow symlinks while traversing" })),
}, { additionalProperties: false });

const SearchParams = Type.Object({
  queryKind: QueryKind,
  pattern: Type.Optional(Type.String({ minLength: 1 })),
  language: Type.Optional(Type.String({ minLength: 1 })),
  inlineRule: Type.Optional(Type.String({ minLength: 1, description: "Inline ast-grep YAML rule text" })),
  ruleFile: Type.Optional(Type.String({ minLength: 1, description: "Project-relative YAML rule file" })),
  ruleFilter: Type.Optional(Type.String({ minLength: 1, description: "Rule-id regex for configured project rules" })),
  paths: Paths,
  globs: Globs,
}, { additionalProperties: false });

const InspectParams = Type.Object({
  pattern: Type.String({ minLength: 1 }),
  code: Type.Optional(Type.String({ minLength: 1, description: "Optional inline code to test; otherwise paths are searched" })),
  language: Type.String({ minLength: 1 }),
  mode: StringEnum(["pattern", "ast", "cst"] as const),
  paths: Paths,
}, { additionalProperties: false });

const RuleTestParams = Type.Object({
  ruleId: Type.String({ minLength: 1, description: "Expected id declared by ruleYaml" }),
  ruleYaml: Type.String({ minLength: 1, description: "Self-contained ast-grep YAML rule" }),
  valid: Type.Array(Type.String({ minLength: 1 }), { minItems: 1, description: "Positive fixtures that must not produce findings" }),
  invalid: Type.Array(Type.String({ minLength: 1 }), { minItems: 1, description: "Negative fixtures that must produce findings" }),
}, { additionalProperties: false });

const ProjectRulesParams = Type.Object({
  ruleFilter: Type.Optional(Type.String({ minLength: 1, description: "Optional regex selecting effective rule ids" })),
}, { additionalProperties: false });

const CodemodPreviewParams = Type.Object({
  ...SelectorProperties,
  page: Type.Optional(Type.Integer({ minimum: 1, description: "One-based preview page" })),
  pageSize: Type.Optional(Type.Integer({ minimum: 1, maximum: 100, description: "Exact replacements per page" })),
  maxFiles: Type.Optional(Type.Integer({ minimum: 1, description: "Maximum affected files; may only tighten configured limits" })),
  maxChanges: Type.Optional(Type.Integer({ minimum: 1, description: "Maximum replacement candidates; may only tighten configured limits" })),
}, { additionalProperties: false });

const CodemodApplyParams = Type.Object({ ...SelectorProperties }, { additionalProperties: false });

export interface OutlineToolDetails {
  readonly kind: "outline";
  readonly result: OutlineResult;
  readonly output: BoundedOutput;
}
export interface SearchToolDetails {
  readonly kind: "search";
  readonly queryKind: CodemodSelector["queryKind"];
  readonly result: SearchResult;
  readonly output: BoundedOutput;
  readonly readOnly: true;
}
export interface InspectToolDetails {
  readonly kind: "inspect";
  readonly result: InspectResult;
  readonly output: BoundedOutput;
}
export interface RuleTestToolDetails {
  readonly kind: "rule-test";
  readonly result: RuleTestResult;
  readonly output: BoundedOutput;
  readonly readOnly: true;
}
export interface ProjectRulesToolDetails {
  readonly kind: "project-rules";
  readonly result: ProjectRuleDiscoveryResult;
  readonly output: BoundedOutput;
  readonly readOnly: true;
}
export interface CodemodPreviewToolDetails {
  readonly kind: "codemod-preview";
  readonly result: CodemodPreviewResult;
  readonly output: BoundedOutput;
  readonly readOnly: true;
}
export interface CodemodApplyToolDetails {
  readonly kind: "codemod-apply";
  readonly result: CodemodApplyResult;
  readonly output: BoundedOutput;
}

type BoundedToolDetails =
  | OutlineToolDetails
  | SearchToolDetails
  | InspectToolDetails
  | RuleTestToolDetails
  | ProjectRulesToolDetails
  | CodemodPreviewToolDetails
  | CodemodApplyToolDetails;
export type ToolDetails = BoundedToolDetails;

interface RecentSelector {
  readonly key: string;
  readonly cwd: string;
  readonly action: "preview" | "apply";
  readonly selector: CodemodSelector;
  readonly label: string;
}

export default function astGrepExtension(pi: ExtensionAPI): void {
  const exec = new PiExecAdapter(pi);
  const profiler = new PhaseProfiler();
  const recent: RecentSelector[] = [];
  let nextRecent = 1;

  function remember(cwd: string, action: RecentSelector["action"], selector: CodemodSelector): void {
    const signature = JSON.stringify(selector);
    const existing = recent.findIndex((item) => item.cwd === cwd && JSON.stringify(item.selector) === signature);
    if (existing >= 0) recent.splice(existing, 1);
    recent.unshift({
      key: `recent-${nextRecent++}`,
      cwd,
      action,
      selector,
      label: selectorLabel(selector),
    });
    recent.splice(12);
  }

  async function clientForCall(ctx: ExtensionContext): Promise<{ client: AstGrepClient; config: AstGrepConfig }> {
    const config = await loadConfig({ agentDir: getAgentDir(), cwd: ctx.cwd });
    return {
      client: new AstGrepClient(exec, config, config.profile ? { profiler } : {}),
      config,
    };
  }

  async function bounded(
    text: string,
    config: AstGrepConfig,
    prefix: string,
    spoolOnTruncate = true,
  ): Promise<BoundedOutput> {
    return boundOutput(text, {
      maxBytes: config.limits.maxOutputBytes,
      maxLines: config.limits.maxOutputLines,
      spoolPrefix: prefix,
      spoolOnTruncate,
    });
  }

  function selectorFrom(params: CodemodSelector): CodemodSelector {
    return {
      queryKind: params.queryKind,
      ...(params.pattern === undefined ? {} : { pattern: params.pattern }),
      ...(params.rewrite === undefined ? {} : { rewrite: params.rewrite }),
      ...(params.language === undefined ? {} : { language: params.language }),
      ...(params.inlineRule === undefined ? {} : { inlineRule: params.inlineRule }),
      ...(params.ruleFile === undefined ? {} : { ruleFile: params.ruleFile }),
      ...(params.ruleFilter === undefined ? {} : { ruleFilter: params.ruleFilter }),
      ...(params.paths === undefined ? {} : { paths: params.paths }),
      ...(params.globs === undefined ? {} : { globs: params.globs }),
    };
  }

  async function applySelector(
    selector: CodemodSelector,
    ctx: ExtensionContext,
    signal?: AbortSignal,
  ): Promise<{ result: CodemodApplyResult; config: AstGrepConfig; output: BoundedOutput }> {
    const { client, config } = await clientForCall(ctx);
    setAstGrepStatus(ctx, "applying", config.statusStyle);
    try {
      const raw = await client.applyCodemod({ cwd: ctx.cwd, ...selector, ...(signal === undefined ? {} : { signal }) });
      let result = raw;
      if (raw.outcome === "applied") {
        // Native output is not a stable changed-file protocol. Empty paths
        // conservatively invalidate the same root without a source reread.
        pi.events.emit(FILES_MUTATED_EVENT, createFilesMutatedEvent(raw.projectRoot));
        result = { ...raw, mutationEventEmitted: true };
      }
      remember(ctx.cwd, "apply", selector);
      const output = await bounded(withDiagnostics(formatCodemodApply(result), result.diagnostics), config, "pi-ast-grep-apply-");
      return { result, config, output };
    } finally {
      setAstGrepStatus(ctx, "ready", config.statusStyle);
    }
  }

  pi.registerTool({
    name: "ast_grep_outline",
    label: "ast-grep outline",
    description: "Read-only structural outline of project files. Filters symbols without reading broad file contents.",
    promptSnippet: "List structural symbols, signatures, imports, exports, and members without broad file reads",
    promptGuidelines: ["Use ast_grep_outline before broad file reads to map unfamiliar code and choose focused files."],
    parameters: OutlineParams,
    async execute(_id, params, signal, onUpdate, ctx) {
      onUpdate?.({ details: {}, content: [{ type: "text", text: "Running ast-grep outline…" }] });
      const { client, config } = await clientForCall(ctx);
      const input: OutlineInput = { cwd: ctx.cwd, ...params, ...(signal === undefined ? {} : { signal }) };
      const result = await client.outline(input);
      const output = await bounded(withDiagnostics(formatOutline(result), result.diagnostics), config, "pi-ast-grep-outline-");
      return { content: [{ type: "text", text: output.text }], details: { kind: "outline", result, output } satisfies OutlineToolDetails };
    },
    renderCall(args, theme) {
      return new Text(theme.fg("toolTitle", theme.bold("ast_grep_outline ")) + theme.fg("accent", short((args.paths ?? ["."]).join(", "))), 0, 0);
    },
    renderResult(result, { expanded, isPartial }, theme) {
      if (isPartial) return partialText(result, theme);
      const details = result.details as OutlineToolDetails | undefined;
      if (!details) return fallbackText(result);
      return richResult(summarizeOutline(details.result) + diagnosticSuffix(details.result.diagnostics, details.output.truncation.truncated), details, expanded, theme);
    },
  });

  pi.registerTool({
    name: "ast_grep_search",
    label: "ast-grep search",
    description: "Read-only structural search over patterns, inline rules, rule files, or configured project rules. Fixes are shown but never applied.",
    promptSnippet: "Search code structurally with patterns or ast-grep rules; findings and fixes are read-only",
    parameters: SearchParams,
    async execute(_id, params, signal, _onUpdate, ctx) {
      const { client, config } = await clientForCall(ctx);
      const input: SearchInput = { cwd: ctx.cwd, ...params, ...(signal === undefined ? {} : { signal }) };
      const result = await client.search(input);
      const output = await bounded(withDiagnostics(formatSearch(result), result.diagnostics), config, "pi-ast-grep-search-");
      return { content: [{ type: "text", text: output.text }], details: { kind: "search", queryKind: params.queryKind, result, output, readOnly: true } satisfies SearchToolDetails };
    },
    renderCall(args, theme) {
      return new Text(theme.fg("toolTitle", theme.bold("ast_grep_search ")) + theme.fg("muted", `${args.queryKind} `) + theme.fg("accent", short(queryLabel(args))), 0, 0);
    },
    renderResult(result, { expanded, isPartial }, theme) {
      if (isPartial) return partialText(result, theme);
      const details = result.details as SearchToolDetails | undefined;
      if (!details) return fallbackText(result);
      return richResult(summarizeSearch(details.result) + diagnosticSuffix(details.result.diagnostics, details.output.truncation.truncated), details, expanded, theme);
    },
  });

  pi.registerTool({
    name: "ast_grep_inspect",
    label: "ast-grep inspect",
    description: "Inspect how ast-grep parses a pattern (pattern/AST/CST) and optionally test it against inline code or paths.",
    promptSnippet: "Inspect ast-grep query parsing and test a pattern against code",
    promptGuidelines: ["Use ast_grep_inspect when ast-grep pattern parsing or metavariable behavior is uncertain."],
    parameters: InspectParams,
    async execute(_id, params, signal, _onUpdate, ctx) {
      const { client, config } = await clientForCall(ctx);
      const input: InspectInput = { cwd: ctx.cwd, ...params, ...(signal === undefined ? {} : { signal }) };
      const result = await client.inspect(input);
      const output = await bounded(withDiagnostics(formatInspect(result), result.diagnostics), config, "pi-ast-grep-inspect-");
      return { content: [{ type: "text", text: output.text }], details: { kind: "inspect", result, output } satisfies InspectToolDetails };
    },
    renderCall(args, theme) {
      return new Text(theme.fg("toolTitle", theme.bold("ast_grep_inspect ")) + theme.fg("muted", `${args.mode} `) + theme.fg("accent", short(args.pattern)), 0, 0);
    },
    renderResult(result, { expanded, isPartial }, theme) {
      if (isPartial) return partialText(result, theme);
      const details = result.details as InspectToolDetails | undefined;
      if (!details) return fallbackText(result);
      return richResult(summarizeInspect(details.result) + diagnosticSuffix(details.result.diagnostics, details.output.truncation.truncated), details, expanded, theme);
    },
  });

  pi.registerTool({
    name: "ast_grep_rule_test",
    label: "ast-grep rule test",
    description: "Test one self-contained ast-grep YAML rule in an isolated temporary project against required valid and invalid fixtures.",
    promptSnippet: "Test candidate ast-grep rules against positive and negative fixtures in isolation",
    promptGuidelines: ["Use ast_grep_rule_test before saving or running a new rule across the codebase."],
    parameters: RuleTestParams,
    async execute(_id, params, signal, _onUpdate, ctx) {
      const { client, config } = await clientForCall(ctx);
      const input: RuleTestInput = { ...params, ...(signal === undefined ? {} : { signal }) };
      const result = await client.testRule(input);
      const output = await bounded(withDiagnostics(formatRuleTest(result), result.diagnostics), config, "pi-ast-grep-rule-test-");
      return { content: [{ type: "text", text: output.text }], details: { kind: "rule-test", result, output, readOnly: true } satisfies RuleTestToolDetails };
    },
    renderCall(args, theme) {
      return new Text(theme.fg("toolTitle", theme.bold("ast_grep_rule_test ")) + theme.fg("accent", short(args.ruleId)), 0, 0);
    },
    renderResult(result, { expanded, isPartial }, theme) {
      if (isPartial) return partialText(result, theme);
      const details = result.details as RuleTestToolDetails | undefined;
      if (!details) return fallbackText(result);
      const summary = summarizeRuleTest(details.result) + diagnosticSuffix(details.result.diagnostics, details.output.truncation.truncated);
      return richRuleTestResult(summary, details, expanded, theme);
    },
  });

  pi.registerTool({
    name: "ast_grep_project_rules",
    label: "ast-grep project rules",
    description: "Discover effective rule ids and severities from configured sgconfig without scanning source files.",
    promptSnippet: "Discover active ast-grep project rules before selecting rule ids or filters",
    promptGuidelines: ["Use ast_grep_project_rules to discover configured rule ids instead of guessing project rule filters."],
    parameters: ProjectRulesParams,
    async execute(_id, params, signal, _onUpdate, ctx) {
      const { client, config } = await clientForCall(ctx);
      const input: ProjectRuleDiscoveryInput = { cwd: ctx.cwd, ...params, ...(signal === undefined ? {} : { signal }) };
      const result = await client.discoverProjectRules(input);
      const output = await bounded(withDiagnostics(formatProjectRules(result), result.diagnostics), config, "pi-ast-grep-project-rules-");
      return { content: [{ type: "text", text: output.text }], details: { kind: "project-rules", result, output, readOnly: true } satisfies ProjectRulesToolDetails };
    },
    renderCall(args, theme) {
      return new Text(theme.fg("toolTitle", theme.bold("ast_grep_project_rules ")) + theme.fg("accent", short(args.ruleFilter ?? "all effective rules")), 0, 0);
    },
    renderResult(result, { expanded, isPartial }, theme) {
      if (isPartial) return partialText(result, theme);
      const details = result.details as ProjectRulesToolDetails | undefined;
      if (!details) return fallbackText(result);
      return richResult(summarizeProjectRules(details.result) + diagnosticSuffix(details.result.diagnostics, details.output.truncation.truncated), details, expanded, theme);
    },
  });

  pi.registerTool({
    name: "ast_grep_codemod_preview",
    label: "ast-grep codemod preview",
    description: "Read an advisory, ephemeral, paginated preview with exact before/replacement/context/conflict data. It never authorizes or persists an apply.",
    promptSnippet: "Read exact paginated ast-grep replacement previews without modifying source",
    promptGuidelines: [
      "Use ast_grep_codemod_preview to inspect exact current-source replacements before a direct apply.",
      "ast_grep_codemod_preview is advisory: apply reruns the selector against current source and does not consume preview output.",
    ],
    parameters: CodemodPreviewParams,
    async execute(_id, params, signal, _onUpdate, ctx) {
      const { client, config } = await clientForCall(ctx);
      setAstGrepStatus(ctx, "preview", config.statusStyle);
      try {
        const selector = selectorFrom(params);
        const input: CodemodPreviewInput = { cwd: ctx.cwd, ...selector, ...(signal === undefined ? {} : { signal }) };
        const candidates = await client.previewCodemod(input);
        const maxFiles = params.maxFiles ?? Math.min(200, config.limits.maxPaths);
        const maxChanges = params.maxChanges ?? config.limits.maxResults;
        if (maxFiles > config.limits.maxPaths) throw new Error(`maxFiles cannot exceed configured limit ${config.limits.maxPaths}`);
        if (maxChanges > config.limits.maxResults) throw new Error(`maxChanges cannot exceed configured limit ${config.limits.maxResults}`);
        const result = await createEphemeralPreview({
          cwd: ctx.cwd,
          selector,
          candidates,
          ...(params.page === undefined ? {} : { page: params.page }),
          ...(params.pageSize === undefined ? {} : { pageSize: params.pageSize }),
          maxFiles,
          maxChanges,
          maxSourceBytes: config.limits.maxProcessOutputBytes,
        });
        remember(ctx.cwd, "preview", selector);
        const output = await bounded(withDiagnostics(formatCodemodPreview(result), result.diagnostics), config, "pi-ast-grep-preview-", false);
        return { content: [{ type: "text", text: output.text }], details: { kind: "codemod-preview", result, output, readOnly: true } satisfies CodemodPreviewToolDetails };
      } finally {
        setAstGrepStatus(ctx, "ready", config.statusStyle);
      }
    },
    renderCall(args, theme) {
      return new Text(theme.fg("toolTitle", theme.bold("ast_grep_codemod_preview ")) + theme.fg("muted", `${args.queryKind} `) + theme.fg("accent", short(queryLabel(args))), 0, 0);
    },
    renderResult(result, { expanded, isPartial }, theme) {
      if (isPartial) return partialText(result, theme);
      const details = result.details as CodemodPreviewToolDetails | undefined;
      if (!details) return fallbackText(result);
      return richResult(summarizeCodemodPreview(details.result) + diagnosticSuffix(details.result.diagnostics, details.output.truncation.truncated), details, expanded, theme);
    },
  });

  pi.registerTool({
    name: "ast_grep_codemod_apply",
    label: "ast-grep native apply",
    description: "Rerun one closed ast-grep selector against current source with native -U in exactly one subprocess. No preview, approval, snapshot, journal, rollback, undo, or recovery layer.",
    promptSnippet: "Apply a closed ast-grep selector directly through one native -U subprocess",
    promptGuidelines: [
      "ast_grep_codemod_apply directly mutates current source; preview first when exact changes need review.",
      "After ast_grep_codemod_apply, use VCS for recovery and run compiler/LSP/tests for semantic verification.",
    ],
    parameters: CodemodApplyParams,
    async execute(_id, params, signal, onUpdate, ctx) {
      onUpdate?.({ details: {}, content: [{ type: "text", text: "Running one native ast-grep -U process…" }] });
      const selector = selectorFrom(params);
      const { result, output } = await applySelector(selector, ctx, signal);
      return { content: [{ type: "text", text: output.text }], details: { kind: "codemod-apply", result, output } satisfies CodemodApplyToolDetails };
    },
    renderCall(args, theme) {
      return new Text(theme.fg("toolTitle", theme.bold("ast_grep_codemod_apply ")) + theme.fg("warning", `${args.queryKind} `) + theme.fg("accent", short(queryLabel(args))), 0, 0);
    },
    renderResult(result, { expanded, isPartial }, theme) {
      if (isPartial) return partialText(result, theme);
      const details = result.details as CodemodApplyToolDetails | undefined;
      if (!details) return fallbackText(result);
      return richResult(summarizeCodemodApply(details.result) + diagnosticSuffix(details.result.diagnostics, details.output.truncation.truncated), details, expanded, theme);
    },
  });

  pi.registerCommand("sg-review", {
    description: "Read an advisory preview from JSON selector args or a recent selector list",
    handler: async (args, ctx) => {
      try {
        const selector = args.trim() === ""
          ? await chooseRecentSelector(ctx, recent.filter((item) => item.cwd === ctx.cwd), "Review recent ast-grep selector")
          : parseSelectorJson(args);
        if (selector === undefined) return;
        const { client, config } = await clientForCall(ctx);
        const candidates = await client.previewCodemod({ cwd: ctx.cwd, ...selector, ...(ctx.signal === undefined ? {} : { signal: ctx.signal }) });
        const result = await createEphemeralPreview({
          cwd: ctx.cwd,
          selector,
          candidates,
          maxFiles: config.limits.maxPaths,
          maxChanges: config.limits.maxResults,
          maxSourceBytes: config.limits.maxProcessOutputBytes,
        });
        remember(ctx.cwd, "preview", selector);
        const output = await bounded(withDiagnostics(formatCodemodPreview(result), result.diagnostics), config, "pi-ast-grep-review-command-", false);
        if (ctx.hasUI) ctx.ui.notify(output.text, "info");
      } catch (error) {
        if (ctx.hasUI) ctx.ui.notify(`ast-grep review failed: ${messageOf(error)}`, "error");
        else throw error;
      }
    },
  });

  pi.registerCommand("sg-apply", {
    description: "Immediately apply JSON selector args or a selector chosen from recent previews/actions",
    handler: async (args, ctx) => {
      try {
        const selector = args.trim() === ""
          ? await chooseRecentSelector(ctx, recent.filter((item) => item.cwd === ctx.cwd), "Apply recent ast-grep selector now")
          : parseSelectorJson(args);
        if (selector === undefined) return;
        const { result, output } = await applySelector(selector, ctx, ctx.signal);
        if (ctx.hasUI) ctx.ui.notify(output.text, result.outcome === "applied" ? "info" : "warning");
      } catch (error) {
        if (ctx.hasUI) ctx.ui.notify(`ast-grep apply failed: ${messageOf(error)}`, "error");
        else throw error;
      }
    },
  });

  pi.registerCommand("sg-rules", {
    description: "List effective configured ast-grep project rules",
    handler: async (args, ctx) => {
      try {
        const { client, config } = await clientForCall(ctx);
        const result = await client.discoverProjectRules({ cwd: ctx.cwd, ...(args.trim() === "" ? {} : { ruleFilter: args.trim() }), ...(ctx.signal === undefined ? {} : { signal: ctx.signal }) });
        const output = await bounded(withDiagnostics(formatProjectRules(result), result.diagnostics), config, "pi-ast-grep-rules-command-");
        if (ctx.hasUI) ctx.ui.notify(output.text, "info");
      } catch (error) {
        if (ctx.hasUI) ctx.ui.notify(`ast-grep rule discovery failed: ${messageOf(error)}`, "error");
        else throw error;
      }
    },
  });

  pi.registerCommand("sg-status", {
    description: "Show explicit ast-grep diagnostics and optional local perf_hooks phase metrics",
    handler: async (_args, ctx) => {
      try {
        const config = await loadConfig({ agentDir: getAgentDir(), cwd: ctx.cwd });
        const capabilities = await new AstGrepClient(exec, config).probe(ctx.signal);
        const metrics = profiler.report();
        const text = [
          `ast-grep: ${capabilities.version ?? "unavailable"}`,
          "apply: native current-source -U, one process, no extension rollback/undo",
          `config: ${[config.globalConfigLoaded && config.globalConfigPath, config.projectConfigLoaded && config.projectConfigPath].filter(Boolean).join(", ") || "defaults"}`,
          `sgconfig: ${config.sgConfigPath ?? "none"}`,
          `profiling: ${config.profile ? "enabled" : "disabled"}`,
          ...(config.profile ? metrics.map((metric) => `${metric.phase}: n=${metric.count} avg=${metric.averageMs.toFixed(2)}ms max=${metric.maxMs.toFixed(2)}ms`) : []),
        ].join("\n");
        if (ctx.hasUI) ctx.ui.notify(text, capabilities.available ? "info" : "warning");
      } catch (error) {
        if (ctx.hasUI) ctx.ui.notify(`ast-grep status failed: ${messageOf(error)}`, "error");
        else throw error;
      }
    },
  });

  pi.on("session_start", async (_event, ctx) => {
    if (!ctx.hasUI) return;
    try {
      const config = await loadConfig({ agentDir: getAgentDir(), cwd: ctx.cwd });
      setAstGrepStatus(ctx, "ready", config.statusStyle);
    } catch {
      setAstGrepStatus(ctx, "error", "ascii");
    }
  });
  pi.on("session_shutdown", async (_event, ctx) => {
    setAstGrepStatus(ctx, undefined);
    profiler.clear();
  });
}

async function chooseRecentSelector(
  ctx: ExtensionCommandContext,
  recent: readonly RecentSelector[],
  title: string,
): Promise<CodemodSelector | undefined> {
  if (recent.length === 0) {
    if (ctx.hasUI) ctx.ui.notify("No recent ast-grep preview or apply selectors in this project. Pass a JSON selector argument.", "warning");
    return undefined;
  }
  if (ctx.mode !== "tui") {
    if (ctx.hasUI) ctx.ui.notify("Pass a JSON selector argument outside TUI mode.", "warning");
    return undefined;
  }
  const items: SelectItem[] = recent.map((item) => ({
    value: item.key,
    label: item.label,
    description: `${item.action} · ${JSON.stringify(item.selector)}`,
  }));
  const selected = await ctx.ui.custom<string | null>((tui, theme, _keybindings, done) => {
    const container = new Container();
    container.addChild(new DynamicBorder((text: string) => theme.fg("accent", text)));
    container.addChild(new Text(theme.fg("accent", theme.bold(title)), 1, 0));
    const list = new SelectList(items, Math.min(items.length, 10), {
      selectedPrefix: (text) => theme.fg("accent", text),
      selectedText: (text) => theme.fg("accent", text),
      description: (text) => theme.fg("muted", text),
      scrollInfo: (text) => theme.fg("dim", text),
      noMatch: (text) => theme.fg("warning", text),
    });
    list.onSelect = (item) => done(item.value);
    list.onCancel = () => done(null);
    container.addChild(list);
    container.addChild(new Text(theme.fg("dim", "↑↓ navigate · Enter select · Esc cancel"), 1, 0));
    container.addChild(new DynamicBorder((text: string) => theme.fg("accent", text)));
    return {
      render: (width: number) => container.render(width),
      invalidate: () => container.invalidate(),
      handleInput: (data: string) => {
        list.handleInput(data);
        tui.requestRender();
      },
    };
  });
  if (selected === null) return undefined;
  return recent.find((item) => item.key === selected)?.selector;
}

function parseSelectorJson(value: string): CodemodSelector {
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch (error) {
    throw new Error(`selector must be one JSON object: ${messageOf(error)}`);
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) throw new Error("selector must be a JSON object");
  const record = parsed as Record<string, unknown>;
  const allowed = new Set(["queryKind", "pattern", "rewrite", "language", "inlineRule", "ruleFile", "ruleFilter", "paths", "globs"]);
  for (const key of Object.keys(record)) if (!allowed.has(key)) throw new Error(`unknown selector field ${JSON.stringify(key)}`);
  if (!["pattern", "inline_rule", "rule_file", "project_rules"].includes(String(record.queryKind))) throw new Error("selector queryKind is required");
  for (const key of ["pattern", "rewrite", "language", "inlineRule", "ruleFile", "ruleFilter"] as const) {
    const item = record[key];
    if (item !== undefined && (typeof item !== "string" || item.length === 0 || item.includes("\0"))) throw new Error(`${key} must be a non-empty string without NUL bytes`);
  }
  for (const key of ["paths", "globs"] as const) {
    const item = record[key];
    if (item !== undefined && (!Array.isArray(item) || item.some((entry) => typeof entry !== "string" || entry.length === 0 || entry.includes("\0")))) {
      throw new Error(`${key} must be an array of non-empty strings without NUL bytes`);
    }
  }
  return record as unknown as CodemodSelector;
}

function selectorLabel(selector: CodemodSelector): string {
  return `${selector.queryKind}: ${short(selector.pattern ?? selector.ruleFile ?? selector.ruleFilter ?? (selector.inlineRule ? "inline YAML" : "configured rules"), 80)}`;
}

function queryLabel(value: { pattern?: string; ruleFile?: string; ruleFilter?: string; inlineRule?: string }): string {
  return value.pattern ?? value.ruleFile ?? value.ruleFilter ?? (value.inlineRule ? "inline YAML" : "configured rules");
}

function withDiagnostics(text: string, diagnostics: readonly { severity: string; message: string }[]): string {
  if (diagnostics.length === 0) return text;
  return `${text}\n\nDiagnostics:\n${diagnostics.map((item) => `- ${item.severity}: ${item.message}`).join("\n")}`;
}

function short(value: string, limit = 120): string {
  const oneLine = value.replace(/\s+/gu, " ");
  return oneLine.length <= limit ? oneLine : `${oneLine.slice(0, limit - 1)}…`;
}

function fallbackText(result: { content: readonly { type: string; text?: string }[] }): Text {
  return new Text(result.content.find((item) => item.type === "text")?.text ?? "", 0, 0);
}

function partialText(
  result: { content: readonly { type: string; text?: string }[] },
  theme: { fg(color: "warning", text: string): string },
): Text {
  const text = result.content.find((item) => item.type === "text")?.text ?? "Working…";
  return new Text(theme.fg("warning", short(text)), 0, 0);
}

function richResult(
  summary: string,
  details: BoundedToolDetails,
  expanded: boolean,
  theme: { fg(color: "success" | "dim", text: string): string },
): Text {
  let text = theme.fg("success", `✓ ${summary}`);
  if (expanded) text += `\n${theme.fg("dim", boundedRendererText(details.output.text))}`;
  return new Text(text, 0, 0);
}

function richRuleTestResult(
  summary: string,
  details: RuleTestToolDetails,
  expanded: boolean,
  theme: { fg(color: "success" | "warning" | "dim", text: string): string },
): Text {
  const passed = details.result.status === "passed";
  let text = theme.fg(passed ? "success" : "warning", `${passed ? "✓" : "!"} ${summary}`);
  if (expanded) text += `\n${theme.fg("dim", boundedRendererText(details.output.text))}`;
  return new Text(text, 0, 0);
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
