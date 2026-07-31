import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { withFileMutationQueue } from "@earendil-works/pi-coding-agent";
import type {
  AstGrepCapabilities,
  CodemodApplyResult,
  CodemodCandidateResult,
  CodemodQueryKind,
  Diagnostic,
  InspectMode,
  InspectResult,
  OperationKind,
  OperationMetadata,
  OperationOutcome,
  OutlineResult,
  ProjectRuleDiscoveryResult,
  RuleTestResult,
  SearchResult,
} from "../domain.js";
import type { AstGrepConfig } from "../config.js";
import {
  buildCodemodApplyArgv,
  buildCodemodPreviewArgv,
  buildInspectArgv,
  buildOutlineArgv,
  buildProjectRuleDiscoveryArgv,
  buildRuleTestArgv,
  buildSearchArgv,
  type CodemodApplyInvocationInput,
  type CodemodPreviewInvocationInput,
  type OutlineItems,
  type OutlineView,
  type SearchInvocationInput,
  type SearchQueryKind,
  validateArgValue,
} from "./argv.js";
import type { ExecAdapter, ExecResult } from "./exec.js";
import { parseNdjson } from "./ndjson.js";
import { normalizeOutlineRecord, normalizeSearchRecord } from "./raw.js";
import { parseProjectRuleDiscovery, parseRuleTestOutput } from "./rule-output.js";
import type { PhaseProfiler } from "../profile.js";

export const VERIFIED_AST_GREP_VERSION = "0.44.1";
const DEBUG_MODES = ["pattern", "ast", "cst"] as const;
const OUTLINE_ITEMS = new Set<OutlineItems>(["auto", "structure", "exports", "imports", "all"]);
const OUTLINE_VIEWS = new Set<OutlineView>(["auto", "names", "signatures", "digest", "expanded"]);
const QUERY_KINDS = new Set<SearchQueryKind>(["pattern", "inline_rule", "rule_file", "project_rules"]);

export interface OutlineInput {
  readonly cwd: string;
  readonly paths?: readonly string[];
  readonly language?: string;
  readonly items?: OutlineItems;
  readonly view?: OutlineView;
  readonly match?: string;
  readonly types?: readonly string[];
  readonly publicMembers?: boolean;
  readonly globs?: readonly string[];
  readonly follow?: boolean;
  readonly signal?: AbortSignal;
}

export interface SearchInput {
  readonly cwd: string;
  readonly queryKind?: SearchQueryKind;
  readonly pattern?: string;
  readonly language?: string;
  readonly inlineRule?: string;
  readonly ruleFile?: string;
  readonly ruleFilter?: string;
  readonly paths?: readonly string[];
  readonly globs?: readonly string[];
  readonly signal?: AbortSignal;
}

export interface InspectInput {
  readonly cwd: string;
  readonly pattern: string;
  readonly language: string;
  readonly mode: InspectMode;
  readonly code?: string;
  readonly paths?: readonly string[];
  readonly signal?: AbortSignal;
}

export interface RuleTestInput {
  readonly ruleId: string;
  readonly ruleYaml: string;
  readonly valid: readonly string[];
  readonly invalid: readonly string[];
  readonly signal?: AbortSignal;
}

export interface ProjectRuleDiscoveryInput {
  readonly cwd: string;
  readonly ruleFilter?: string;
  readonly signal?: AbortSignal;
}

export interface CodemodPreviewInput extends SearchInput {
  readonly rewrite?: string;
}

export type AstGrepErrorKind = "cancelled" | "timeout" | "execution" | "exit" | "parse" | "contract" | "validation";

export class AstGrepClientError extends Error {
  readonly kind: AstGrepErrorKind;
  readonly exitCode?: number;
  readonly diagnostics: readonly Diagnostic[];

  constructor(
    kind: AstGrepErrorKind,
    message: string,
    options: { readonly exitCode?: number; readonly diagnostics?: readonly Diagnostic[]; readonly cause?: unknown } = {},
  ) {
    super(message, options.cause === undefined ? undefined : { cause: options.cause });
    this.name = "AstGrepClientError";
    this.kind = kind;
    if (options.exitCode !== undefined) this.exitCode = options.exitCode;
    this.diagnostics = options.diagnostics ?? [];
  }
}

export function classifyExitCode(
  kind: Exclude<OperationKind, "probe">,
  code: number,
): OperationOutcome | "failure" {
  if (code === 0) return "success";
  if ((kind === "search" || kind === "inspect" || kind === "codemod-preview" || kind === "codemod-apply") && code === 1) return "no-match";
  return "failure";
}

/** Closed runtime validation; schemas are not treated as a security boundary. */
export function validateSearchInput(
  input: SearchInput,
  options: { readonly hasProjectConfig?: boolean } = {},
): SearchQueryKind {
  const kind = input.queryKind ?? "pattern";
  if (!QUERY_KINDS.has(kind)) throw validationError(`unsupported queryKind ${JSON.stringify(kind)}`);
  validateStrings(input.paths, "path");
  validateStrings(input.globs, "glob");
  const present = (key: keyof SearchInput): boolean => input[key] !== undefined;
  const reject = (...keys: (keyof SearchInput)[]): void => {
    for (const key of keys) if (present(key)) throw validationError(`${String(key)} is irrelevant for queryKind ${kind}`);
  };

  switch (kind) {
    case "pattern":
      requireString(input.pattern, "pattern");
      requireString(input.language, "language");
      reject("inlineRule", "ruleFile", "ruleFilter");
      break;
    case "inline_rule":
      requireString(input.inlineRule, "inlineRule");
      reject("pattern", "language", "ruleFile", "ruleFilter");
      break;
    case "rule_file":
      requireString(input.ruleFile, "ruleFile");
      reject("pattern", "language", "inlineRule", "ruleFilter");
      break;
    case "project_rules":
      if (!(options.hasProjectConfig ?? false)) throw validationError("project_rules requires a configured or discovered sgconfig");
      if (input.ruleFilter !== undefined) requireString(input.ruleFilter, "ruleFilter");
      reject("pattern", "language", "inlineRule", "ruleFile");
      break;
  }
  return kind;
}

export class AstGrepClient {
  readonly #exec: ExecAdapter;
  readonly #config: AstGrepConfig;
  readonly #profiler?: PhaseProfiler;

  constructor(exec: ExecAdapter, config: AstGrepConfig, options: { readonly profiler?: PhaseProfiler } = {}) {
    this.#exec = exec;
    this.#config = config;
    if (options.profiler !== undefined) this.#profiler = options.profiler;
  }

  async probe(signal?: AbortSignal): Promise<AstGrepCapabilities> {
    const argv = ["--version"];
    const started = Date.now();
    try {
      const result = await this.#execute(argv, ".", signal);
      const diagnostics = [...this.#config.diagnostics, ...diagnosticsFromStderr(result.stderr)];
      if (result.code !== 0 || result.killed) {
        diagnostics.push({
          severity: "error",
          source: "ast-grep",
          message: result.killed ? "ast-grep version probe was killed" : `ast-grep version probe exited ${result.code}`,
        });
        return unavailableCapabilities(diagnostics);
      }
      const version = parseVersion(result.stdout);
      const verifiedContract = version === VERIFIED_AST_GREP_VERSION;
      if (!verifiedContract) {
        diagnostics.push({
          severity: "warning",
          source: "ast-grep",
          message: `ast-grep ${version ?? "version output was unrecognized"}; only ${VERIFIED_AST_GREP_VERSION} is verified`,
        });
      }
      return {
        available: true,
        ...(version === undefined ? {} : { version }),
        verifiedContract,
        outlineJsonStream: verifiedContract,
        runJsonStream: verifiedContract,
        ruleTesting: verifiedContract,
        projectRuleDiscovery: verifiedContract,
        codemodPreview: verifiedContract,
        nativeApply: true,
        debugQueryModes: verifiedContract ? DEBUG_MODES : [],
        diagnostics,
        operation: operation("probe", this.#config.executable, argv, started, result.code, "success"),
      };
    } catch (error) {
      return unavailableCapabilities([
        ...this.#config.diagnostics,
        { severity: "error", source: "ast-grep", message: error instanceof Error ? error.message : String(error) },
      ]);
    }
  }

  async requireVerifiedContract(signal?: AbortSignal): Promise<AstGrepCapabilities> {
    const capabilities = await this.probe(signal);
    if (!capabilities.available || !capabilities.verifiedContract) {
      const reason = capabilities.diagnostics.map((item) => item.message).join("; ") || "ast-grep is unavailable";
      throw new AstGrepClientError(
        "contract",
        `Verified ast-grep ${VERIFIED_AST_GREP_VERSION} contract unavailable: ${reason}`,
        { diagnostics: capabilities.diagnostics },
      );
    }
    return capabilities;
  }

  async outline(input: OutlineInput): Promise<OutlineResult> {
    this.#checkPathCount(input.paths);
    this.#checkGlobs(input.globs);
    if (input.language !== undefined) requireString(input.language, "language");
    if (input.match !== undefined) requireString(input.match, "match");
    validateStrings(input.types, "type");
    if (input.items !== undefined && !OUTLINE_ITEMS.has(input.items)) throw validationError(`unsupported outline items ${input.items}`);
    if (input.view !== undefined && !OUTLINE_VIEWS.has(input.view)) throw validationError(`unsupported outline view ${input.view}`);
    const argv = buildOutlineArgv({
      cwd: input.cwd,
      ...(input.paths === undefined ? {} : { paths: input.paths }),
      ...(input.language === undefined ? {} : { language: input.language }),
      ...(input.items === undefined ? {} : { items: input.items }),
      ...(input.view === undefined ? {} : { view: input.view }),
      ...(input.match === undefined ? {} : { match: input.match }),
      ...(input.types === undefined ? {} : { types: input.types }),
      ...(input.publicMembers === undefined ? {} : { publicMembers: input.publicMembers }),
      ...(input.globs === undefined ? {} : { globs: input.globs }),
      ...(input.follow === undefined ? {} : { follow: input.follow }),
      ...(this.#config.sgConfigPath === undefined ? {} : { sgConfigPath: this.#config.sgConfigPath }),
    });
    const completed = await this.#run("outline", argv, input.cwd, input.signal, false);
    assertResultRecordLimit(completed.result.stdout, this.#config.limits.maxResults);
    try {
      const records = parseNdjson(completed.result.stdout, { maxRecords: this.#config.limits.maxResults });
      return {
        files: records.map((record) => normalizeOutlineRecord(record, input.cwd)),
        diagnostics: completed.diagnostics,
        operation: completed.operation,
      };
    } catch (error) {
      throw parseError("outline", error, completed.diagnostics);
    }
  }

  async search(input: SearchInput): Promise<SearchResult> {
    this.#checkPathCount(input.paths);
    this.#checkGlobs(input.globs);
    const kind = validateSearchInput(input, {
      hasProjectConfig: this.#config.sgConfigPath !== undefined,
    });
    this.#checkInputSizes(input);
    const argvInput = this.#searchArgvInput(input, kind);
    const argv = buildSearchArgv(argvInput);
    const completed = await this.#run("search", argv, input.cwd, input.signal, kind === "pattern");
    assertResultRecordLimit(completed.result.stdout, this.#config.limits.maxResults);
    try {
      const records = parseNdjson(completed.result.stdout, { maxRecords: this.#config.limits.maxResults });
      if (completed.operation.outcome === "no-match" && records.length !== 0) throw new Error("exit code 1 returned match records");
      return {
        matches: records.map((record) => normalizeSearchRecord(record, input.cwd)),
        diagnostics: completed.diagnostics,
        operation: completed.operation,
      };
    } catch (error) {
      throw parseError("search", error, completed.diagnostics);
    }
  }

  async previewCodemod(input: CodemodPreviewInput): Promise<CodemodCandidateResult> {
    this.#checkPathCount(input.paths);
    this.#checkGlobs(input.globs);
    const queryKind = validateSearchInput(input, {
      hasProjectConfig: this.#config.sgConfigPath !== undefined,
    }) as CodemodQueryKind;
    if (queryKind === "pattern") requireString(input.rewrite, "rewrite");
    else if (input.rewrite !== undefined) throw validationError(`rewrite is irrelevant for queryKind ${queryKind}`);
    this.#checkInputSizes(input);
    if (input.rewrite !== undefined && Buffer.byteLength(input.rewrite) > this.#config.limits.maxOutputBytes) {
      throw validationError(`rewrite exceeds configured input limit ${this.#config.limits.maxOutputBytes} bytes`);
    }

    const searchArgv = this.#searchArgvInput(input, queryKind);
    const argvInput: CodemodPreviewInvocationInput = queryKind === "pattern"
      ? { ...searchArgv, rewrite: input.rewrite! } as CodemodPreviewInvocationInput
      : searchArgv as CodemodPreviewInvocationInput;
    const argv = buildCodemodPreviewArgv(argvInput);
    const completed = await this.#run("codemod-preview", argv, input.cwd, input.signal, queryKind === "pattern");
    assertResultRecordLimit(completed.result.stdout, this.#config.limits.maxResults);
    try {
      const records = parseNdjson(completed.result.stdout, { maxRecords: this.#config.limits.maxResults });
      if (completed.operation.outcome === "no-match" && records.length !== 0) throw new Error("exit code 1 returned match records");
      const normalized = records.map((record) => normalizeSearchRecord(record, input.cwd));
      const matches = normalized.filter((match) => {
        const hasReplacement = match.replacement !== undefined;
        const hasOffsets = match.replacementOffsets !== undefined;
        if (hasReplacement !== hasOffsets) throw new Error("replacement and replacementOffsets must appear together");
        return hasReplacement;
      });
      return {
        queryKind,
        matches,
        skippedWithoutFix: normalized.length - matches.length,
        diagnostics: completed.diagnostics,
        operation: completed.operation,
      };
    } catch (error) {
      throw parseError("codemod preview", error, completed.diagnostics);
    }
  }

  async applyCodemod(input: CodemodPreviewInput): Promise<CodemodApplyResult> {
    const prepare = (): { readonly queryKind: CodemodQueryKind; readonly argv: string[] } => {
      this.#checkPathCount(input.paths);
      this.#checkGlobs(input.globs);
      const queryKind = validateSearchInput(input, {
        hasProjectConfig: this.#config.sgConfigPath !== undefined,
      }) as CodemodQueryKind;
      if (queryKind === "pattern") requireString(input.rewrite, "rewrite");
      else if (input.rewrite !== undefined) throw validationError(`rewrite is irrelevant for queryKind ${queryKind}`);
      this.#checkInputSizes(input);
      if (input.rewrite !== undefined && Buffer.byteLength(input.rewrite) > this.#config.limits.maxOutputBytes) {
        throw validationError(`rewrite exceeds configured input limit ${this.#config.limits.maxOutputBytes} bytes`);
      }
      const searchInput = this.#searchArgvInput(input, queryKind);
      const applyInput: CodemodApplyInvocationInput = queryKind === "pattern"
        ? { ...searchInput, rewrite: input.rewrite! } as CodemodApplyInvocationInput
        : searchInput as CodemodApplyInvocationInput;
      return { queryKind, argv: buildCodemodApplyArgv(applyInput) };
    };

    const prepared = this.#profiler === undefined
      ? prepare()
      : this.#profiler.measureSync("apply.validate-and-build", prepare);
    const started = Date.now();
    const execute = (): Promise<ExecResult> => this.#execute(prepared.argv, input.cwd, input.signal);
    const result = this.#profiler === undefined
      ? await execute()
      : await this.#profiler.measure("apply.exec", execute);
    const diagnostics = [...this.#config.diagnostics, ...diagnosticsFromStderr(result.stderr)];
    if (result.killed) {
      const cancelled = input.signal?.aborted === true;
      throw new AstGrepClientError(
        cancelled ? "cancelled" : "timeout",
        cancelled ? "ast-grep codemod apply was cancelled" : `ast-grep codemod apply exceeded ${this.#config.limits.timeoutMs}ms`,
        { exitCode: result.code, diagnostics },
      );
    }
    const operationOutcome = classifyExitCode("codemod-apply", result.code);
    if (operationOutcome === "failure") {
      throw new AstGrepClientError("exit", `ast-grep codemod apply exited with code ${result.code}`, {
        exitCode: result.code,
        diagnostics,
      });
    }
    const applied = operationOutcome === "success";
    return {
      kind: "codemod-apply",
      sourceMutation: applied,
      queryKind: prepared.queryKind,
      projectRoot: resolve(input.cwd),
      outcome: applied ? "applied" : "no-match",
      stdout: result.stdout,
      stderr: result.stderr,
      diagnostics,
      operation: operation("codemod-apply", this.#config.executable, prepared.argv, started, result.code, operationOutcome),
      subprocessCount: 1,
      mutationEventEmitted: false,
    };
  }

  async testRule(input: RuleTestInput): Promise<RuleTestResult> {
    requireString(input.ruleId, "ruleId");
    requireString(input.ruleYaml, "ruleYaml");
    validateFixtureSet(input.valid, "valid", this.#config.limits.maxResults);
    validateFixtureSet(input.invalid, "invalid", this.#config.limits.maxResults);
    const fixtureCount = input.valid.length + input.invalid.length;
    if (fixtureCount > this.#config.limits.maxResults) {
      throw validationError(`fixture count ${fixtureCount} exceeds configured limit ${this.#config.limits.maxResults}`);
    }
    const inputBytes = Buffer.byteLength(input.ruleYaml)
      + input.valid.reduce((sum, fixture) => sum + Buffer.byteLength(fixture), 0)
      + input.invalid.reduce((sum, fixture) => sum + Buffer.byteLength(fixture), 0);
    if (inputBytes > this.#config.limits.maxProcessOutputBytes) {
      throw validationError(`rule and fixtures exceed configured input limit ${this.#config.limits.maxProcessOutputBytes} bytes`);
    }

    const directory = await mkdtemp(join(tmpdir(), "pi-ast-grep-rule-test-"));
    const rulesDirectory = join(directory, "rules");
    const testsDirectory = join(directory, "rule-tests");
    const rulePath = join(rulesDirectory, "candidate.yml");
    const testPath = join(testsDirectory, "candidate-test.yml");
    const configPath = join(directory, "sgconfig.yml");
    try {
      await mkdir(rulesDirectory, { recursive: true, mode: 0o700 });
      await mkdir(testsDirectory, { recursive: true, mode: 0o700 });
      const files = [
        [rulePath, input.ruleYaml],
        [testPath, JSON.stringify({ id: input.ruleId, valid: input.valid, invalid: input.invalid }, null, 2)],
        [configPath, JSON.stringify({ ruleDirs: ["rules"], testConfigs: [{ testDir: "rule-tests" }] }, null, 2)],
      ] as const;
      for (const [path, contents] of files) {
        await withFileMutationQueue(path, () => writeFile(path, contents, { encoding: "utf8", mode: 0o600, flag: "wx" }));
      }

      const argv = buildRuleTestArgv({ configPath: "sgconfig.yml", testDir: "rule-tests" });
      const started = Date.now();
      const result = await this.#execute(argv, directory, input.signal);
      const diagnostics = [...this.#config.diagnostics, ...diagnosticsFromStderr(result.stderr)];
      if (result.killed) {
        const cancelled = input.signal?.aborted === true;
        throw new AstGrepClientError(
          cancelled ? "cancelled" : "timeout",
          cancelled ? "ast-grep rule test was cancelled" : `ast-grep rule test exceeded ${this.#config.limits.timeoutMs}ms`,
          { exitCode: result.code, diagnostics },
        );
      }
      const parsed = parseRuleTestOutput(result.stdout, result.stderr, result.code, input.valid, input.invalid);
      if (parsed.configurationMissing) {
        diagnostics.push({
          severity: "error",
          source: "ast-grep",
          message: `Rule id ${JSON.stringify(input.ruleId)} was not found; ensure ruleYaml declares the same id`,
        });
      }
      const outcome: OperationOutcome = parsed.status === "passed"
        ? "success"
        : parsed.status === "failed"
          ? "test-failed"
          : "invalid";
      return {
        ruleId: input.ruleId,
        status: parsed.status,
        fixtures: parsed.fixtures,
        passedRuleCount: parsed.passedRuleCount,
        failedRuleCount: parsed.failedRuleCount,
        report: [result.stdout.trim(), result.stderr.trim()].filter(Boolean).join("\n\n"),
        diagnostics,
        operation: operation("rule-test", this.#config.executable, argv, started, result.code, outcome),
      };
    } finally {
      try {
        await rm(directory, { recursive: true, force: true });
      } catch {
        // Best-effort cleanup; the private temporary directory contains only supplied fixtures.
      }
    }
  }

  async discoverProjectRules(input: ProjectRuleDiscoveryInput): Promise<ProjectRuleDiscoveryResult> {
    if (this.#config.sgConfigPath === undefined) {
      const reason = this.#config.discoverSgConfig
        ? `no sgconfig.yml or sgconfig.yaml was configured or discovered from ${input.cwd}`
        : "no sgconfig was configured and sgconfig discovery is disabled";
      throw validationError(reason);
    }
    if (input.ruleFilter !== undefined) requireString(input.ruleFilter, "ruleFilter");
    const argv = buildProjectRuleDiscoveryArgv({
      cwd: input.cwd,
      sgConfigPath: this.#config.sgConfigPath,
      ...(input.ruleFilter === undefined ? {} : { ruleFilter: input.ruleFilter }),
    });
    const started = Date.now();
    const result = await this.#execute(argv, input.cwd, input.signal);
    const parsed = parseProjectRuleDiscovery(result.stderr);
    const diagnostics = [...this.#config.diagnostics, ...diagnosticsFromStderr(parsed.diagnosticsText)];
    if (result.killed) {
      const cancelled = input.signal?.aborted === true;
      throw new AstGrepClientError(
        cancelled ? "cancelled" : "timeout",
        cancelled ? "ast-grep project rule discovery was cancelled" : `ast-grep project rule discovery exceeded ${this.#config.limits.timeoutMs}ms`,
        { exitCode: result.code, diagnostics },
      );
    }
    if (result.code !== 0) {
      throw new AstGrepClientError("exit", `ast-grep project rule discovery exited with code ${result.code}`, {
        exitCode: result.code,
        diagnostics,
      });
    }
    if (result.stdout.trim() !== "") {
      throw new AstGrepClientError("contract", "project rule discovery unexpectedly scanned source files", { diagnostics });
    }
    if (parsed.rules.length !== parsed.effectiveRuleCount) {
      throw new AstGrepClientError(
        "parse",
        `project rule discovery reported ${parsed.effectiveRuleCount} effective rules but described ${parsed.rules.length}`,
        { diagnostics },
      );
    }
    return {
      rules: parsed.rules,
      effectiveRuleCount: parsed.effectiveRuleCount,
      skippedRuleCount: parsed.skippedRuleCount,
      diagnostics,
      operation: operation("rule-discovery", this.#config.executable, argv, started, result.code, "success"),
    };
  }

  async inspect(input: InspectInput): Promise<InspectResult> {
    this.#checkPathCount(input.paths);
    requireString(input.pattern, "pattern");
    requireString(input.language, "language");
    if (!DEBUG_MODES.includes(input.mode)) throw validationError(`unsupported inspect mode ${input.mode}`);
    if (input.code !== undefined) {
      if (input.paths !== undefined) throw validationError("paths is irrelevant when inline code is provided");
      requireString(input.code, "code");
      if (Buffer.byteLength(input.code) > this.#config.limits.maxOutputBytes) {
        throw validationError(`code exceeds configured input limit ${this.#config.limits.maxOutputBytes} bytes`);
      }
      return this.#inspectInline(input);
    }
    return this.#inspectPaths(input, input.cwd, input.paths, false);
  }

  async #inspectInline(input: InspectInput): Promise<InspectResult> {
    const directory = await mkdtemp(join(tmpdir(), "pi-ast-grep-inspect-"));
    const filename = `snippet.${languageExtension(input.language)}`;
    const path = join(directory, filename);
    try {
      // Participate in Pi's per-file mutation queue for the complete temp write/use window.
      return await withFileMutationQueue(path, async () => {
        await writeFile(path, input.code!, { encoding: "utf8", mode: 0o600 });
        const result = await this.#inspectPaths(input, directory, [filename], true);
        return { ...result, matches: result.matches.map((match) => ({ ...match, file: "<inline>" })) };
      });
    } finally {
      // Best-effort cleanup; do not fail the inspect result if temp removal races.
      try {
        await rm(directory, { recursive: true, force: true });
      } catch {
        // ignore
      }
    }
  }

  async #inspectPaths(
    input: InspectInput,
    executionCwd: string,
    paths: readonly string[] | undefined,
    inlineCode: boolean,
  ): Promise<InspectResult> {
    const argv = buildInspectArgv({
      cwd: executionCwd,
      pattern: input.pattern,
      language: input.language,
      mode: input.mode,
      ...(paths === undefined ? {} : { paths }),
      ...(this.#config.sgConfigPath === undefined ? {} : { sgConfigPath: this.#config.sgConfigPath }),
    });
    const completed = await this.#run("inspect", argv, executionCwd, input.signal, true, true);
    assertResultRecordLimit(completed.result.stdout, this.#config.limits.maxResults);
    try {
      const records = parseNdjson(completed.result.stdout, { maxRecords: this.#config.limits.maxResults });
      if (completed.operation.outcome === "no-match" && records.length !== 0) throw new Error("exit code 1 returned match records");
      return {
        mode: input.mode,
        inlineCode,
        queryTree: completed.queryTree ?? "",
        matches: records.map((record) => normalizeSearchRecord(record, executionCwd)),
        diagnostics: completed.diagnostics,
        operation: completed.operation,
      };
    } catch (error) {
      throw parseError("inspect", error, completed.diagnostics);
    }
  }

  #searchArgvInput(input: SearchInput, kind: SearchQueryKind): SearchInvocationInput {
    const common = {
      cwd: input.cwd,
      ...(input.paths === undefined ? {} : { paths: input.paths }),
      ...(input.globs === undefined ? {} : { globs: input.globs }),
    };
    switch (kind) {
      case "pattern": return {
        ...common,
        queryKind: "pattern",
        pattern: input.pattern!,
        language: input.language!,
        ...(this.#config.sgConfigPath === undefined ? {} : { sgConfigPath: this.#config.sgConfigPath }),
      };
      case "inline_rule": return {
        ...common,
        queryKind: "inline_rule",
        inlineRule: input.inlineRule!,
        ...(this.#config.sgConfigPath === undefined ? {} : { sgConfigPath: this.#config.sgConfigPath }),
      };
      case "rule_file": return {
        ...common,
        queryKind: "rule_file",
        ruleFile: input.ruleFile!,
        ...(this.#config.sgConfigPath === undefined ? {} : { sgConfigPath: this.#config.sgConfigPath }),
      };
      case "project_rules": return {
        ...common,
        queryKind: "project_rules",
        sgConfigPath: this.#config.sgConfigPath!,
        ...(input.ruleFilter === undefined ? {} : { ruleFilter: input.ruleFilter }),
      };
    }
  }

  #checkPathCount(paths: readonly string[] | undefined): void {
    if (paths !== undefined && paths.length > this.#config.limits.maxPaths) {
      throw validationError(`path count ${paths.length} exceeds configured limit ${this.#config.limits.maxPaths}`);
    }
    validateStrings(paths, "path");
  }

  #checkGlobs(globs: readonly string[] | undefined): void {
    if (globs !== undefined && globs.length > this.#config.limits.maxPaths) {
      throw validationError(`glob count ${globs.length} exceeds configured limit ${this.#config.limits.maxPaths}`);
    }
    validateStrings(globs, "glob");
  }

  #checkInputSizes(input: SearchInput): void {
    for (const [name, value] of [["inlineRule", input.inlineRule], ["pattern", input.pattern]] as const) {
      if (value !== undefined && Buffer.byteLength(value) > this.#config.limits.maxOutputBytes) {
        throw validationError(`${name} exceeds configured input limit ${this.#config.limits.maxOutputBytes} bytes`);
      }
    }
  }

  async #run(
    kind: Exclude<OperationKind, "probe">,
    argv: string[],
    cwd: string,
    signal: AbortSignal | undefined,
    allowExitOne: boolean,
    separateDebug = false,
  ): Promise<{
    readonly result: ExecResult;
    readonly diagnostics: readonly Diagnostic[];
    readonly operation: OperationMetadata;
    readonly queryTree?: string;
  }> {
    const started = Date.now();
    const result = await this.#execute(argv, cwd, signal);
    const separated = separateDebug ? separateDebugTree(result.stderr) : { queryTree: undefined, diagnosticsText: result.stderr };
    const diagnostics = [...this.#config.diagnostics, ...diagnosticsFromStderr(separated.diagnosticsText)];
    if (result.killed) {
      const cancelled = signal?.aborted === true;
      throw new AstGrepClientError(
        cancelled ? "cancelled" : "timeout",
        cancelled ? `ast-grep ${kind} was cancelled` : `ast-grep ${kind} exceeded ${this.#config.limits.timeoutMs}ms`,
        { exitCode: result.code, diagnostics },
      );
    }
    const outcome = result.code === 1 && !allowExitOne ? "failure" : classifyExitCode(kind, result.code);
    if (outcome === "failure") {
      throw new AstGrepClientError("exit", `ast-grep ${kind} exited with code ${result.code}`, {
        exitCode: result.code,
        diagnostics,
      });
    }
    return {
      result,
      diagnostics,
      operation: operation(kind, this.#config.executable, argv, started, result.code, outcome),
      ...(separated.queryTree === undefined ? {} : { queryTree: separated.queryTree }),
    };
  }

  async #execute(argv: string[], cwd: string, signal: AbortSignal | undefined): Promise<ExecResult> {
    if (signal?.aborted) throw new AstGrepClientError("cancelled", "ast-grep operation was cancelled before execution");
    try {
      const result = await this.#exec.exec(this.#config.executable, argv, {
        cwd,
        timeout: this.#config.limits.timeoutMs,
        ...(signal === undefined ? {} : { signal }),
      });
      // Process capture bounds are independent of model-facing boundOutput limits.
      enforceProcessOutputLimit(
        result,
        this.#config.limits.maxProcessOutputBytes,
        this.#config.limits.maxProcessOutputLines,
      );
      return result;
    } catch (error) {
      if (error instanceof AstGrepClientError) throw error;
      if (signal?.aborted) throw new AstGrepClientError("cancelled", "ast-grep operation was cancelled", { cause: error });
      throw new AstGrepClientError("execution", `could not execute ast-grep: ${error instanceof Error ? error.message : String(error)}`, { cause: error });
    }
  }
}

function operation(
  kind: OperationKind,
  executable: string,
  argv: readonly string[],
  started: number,
  exitCode: number,
  outcome: OperationOutcome,
): OperationMetadata {
  return {
    kind,
    executable,
    argv: [...argv],
    startedAt: new Date(started).toISOString(),
    durationMs: Math.max(0, Date.now() - started),
    exitCode,
    outcome,
  };
}

function parseVersion(stdout: string): string | undefined {
  return /^ast-grep\s+(\d+\.\d+\.\d+)\s*$/u.exec(stdout)?.[1];
}

export function separateDebugTree(stderr: string): { readonly queryTree?: string; readonly diagnosticsText: string } {
  const match = /^Debug (?:Pattern|AST|CST):/mu.exec(stderr);
  if (match?.index === undefined) return { diagnosticsText: stderr };
  return {
    diagnosticsText: stderr.slice(0, match.index).trim(),
    queryTree: stderr.slice(match.index).trim(),
  };
}

function diagnosticsFromStderr(stderr: string): Diagnostic[] {
  return stderr
    .trim()
    .split(/\n\s*\n/u)
    .map((message) => message.trim())
    .filter((message) => message !== "")
    .map((message) => ({
      severity: /^error\b|^error:/iu.test(message)
        ? "error" as const
        : /^warning\b|^warning:/iu.test(message)
          ? "warning" as const
          : "info" as const,
      source: "ast-grep" as const,
      message,
    }));
}

function assertResultRecordLimit(stdout: string, maxResults: number): void {
  let records = 0;
  for (const line of stdout.split(/\r?\n/u)) {
    if (line.trim() === "") continue;
    records += 1;
    if (records > maxResults) {
      throw new AstGrepClientError("execution", `ast-grep result count exceeds configured limit ${maxResults}`);
    }
  }
}

function enforceProcessOutputLimit(result: ExecResult, maxBytes: number, maxLines: number): void {
  const bytes = Buffer.byteLength(result.stdout) + Buffer.byteLength(result.stderr);
  const lines = countLines(result.stdout) + countLines(result.stderr);
  if (bytes > maxBytes) {
    throw new AstGrepClientError("execution", `ast-grep process output ${bytes} bytes exceeds configured limit ${maxBytes}`);
  }
  if (lines > maxLines) {
    throw new AstGrepClientError("execution", `ast-grep process output ${lines} lines exceeds configured limit ${maxLines}`);
  }
}

function languageExtension(language: string): string {
  const normalized = language.toLowerCase().replace(/[^a-z0-9+#]/gu, "");
  const extensions: Record<string, string> = {
    ts: "ts", typescript: "ts", tsx: "tsx",
    js: "js", javascript: "js", jsx: "jsx",
    py: "py", python: "py", rs: "rs", rust: "rs", go: "go",
    java: "java", c: "c", cpp: "cpp", "c++": "cpp", cs: "cs", "c#": "cs",
    ruby: "rb", rb: "rb", php: "php", swift: "swift", kotlin: "kt", scala: "scala",
    html: "html", css: "css", json: "json", yaml: "yml",
  };
  return extensions[normalized] ?? (normalized.replace(/[^a-z0-9]/gu, "").slice(0, 12) || "txt");
}

function countLines(text: string): number {
  return text === "" ? 0 : text.split(/\r?\n/u).length;
}

function requireString(value: string | undefined, name: string): string {
  if (value === undefined) throw validationError(`${name} is required`);
  try {
    return validateArgValue(name, value);
  } catch (error) {
    throw validationError(error instanceof Error ? error.message : String(error));
  }
}

function validateStrings(values: readonly string[] | undefined, name: string): void {
  for (const value of values ?? []) requireString(value, name);
}

function validateFixtureSet(values: readonly string[], name: string, maxResults: number): void {
  if (!Array.isArray(values) || values.length === 0) throw validationError(`${name} must contain at least one fixture`);
  if (values.length > maxResults) throw validationError(`${name} fixture count exceeds configured limit ${maxResults}`);
  validateStrings(values, `${name} fixture`);
}

function validationError(message: string): AstGrepClientError {
  return new AstGrepClientError("validation", message);
}

function unavailableCapabilities(diagnostics: readonly Diagnostic[]): AstGrepCapabilities {
  return {
    available: false,
    verifiedContract: false,
    outlineJsonStream: false,
    runJsonStream: false,
    ruleTesting: false,
    projectRuleDiscovery: false,
    codemodPreview: false,
    nativeApply: true,
    debugQueryModes: [],
    diagnostics,
  };
}

function parseError(kind: string, error: unknown, diagnostics: readonly Diagnostic[]): AstGrepClientError {
  if (error instanceof AstGrepClientError) return error;
  return new AstGrepClientError(
    "parse",
    `Could not parse ast-grep ${kind} output: ${error instanceof Error ? error.message : String(error)}`,
    { diagnostics, cause: error },
  );
}
