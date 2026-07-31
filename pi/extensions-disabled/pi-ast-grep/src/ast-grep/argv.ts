import type { InspectMode } from "../domain.js";
import { resolveProjectInput } from "./path.js";

export type OutlineItems = "auto" | "structure" | "exports" | "imports" | "all";
export type OutlineView = "auto" | "names" | "signatures" | "digest" | "expanded";
export type SearchQueryKind = "pattern" | "inline_rule" | "rule_file" | "project_rules";

export interface CommonInvocationInput {
  readonly cwd: string;
  readonly paths?: readonly string[];
  readonly language?: string;
  readonly sgConfigPath?: string;
  readonly globs?: readonly string[];
  readonly follow?: boolean;
}

export interface OutlineInvocationInput extends CommonInvocationInput {
  readonly items?: OutlineItems;
  readonly view?: OutlineView;
  readonly match?: string;
  readonly types?: readonly string[];
  readonly publicMembers?: boolean;
}

export interface PatternSearchInvocationInput extends CommonInvocationInput {
  readonly queryKind?: "pattern";
  readonly pattern: string;
  readonly language: string;
}

export interface InlineRuleSearchInvocationInput extends CommonInvocationInput {
  readonly queryKind: "inline_rule";
  readonly inlineRule: string;
}

export interface RuleFileSearchInvocationInput extends CommonInvocationInput {
  readonly queryKind: "rule_file";
  readonly ruleFile: string;
}

export interface ProjectRulesSearchInvocationInput extends CommonInvocationInput {
  readonly queryKind: "project_rules";
  readonly ruleFilter?: string;
  readonly sgConfigPath: string;
}

export type SearchInvocationInput =
  | PatternSearchInvocationInput
  | InlineRuleSearchInvocationInput
  | RuleFileSearchInvocationInput
  | ProjectRulesSearchInvocationInput;

export interface InspectInvocationInput extends PatternSearchInvocationInput {
  readonly mode: InspectMode;
}

export interface RuleTestInvocationInput {
  readonly configPath: string;
  readonly testDir: string;
}

export interface ProjectRuleDiscoveryInvocationInput {
  readonly cwd: string;
  readonly sgConfigPath: string;
  readonly ruleFilter?: string;
}

export interface PatternCodemodPreviewInvocationInput extends PatternSearchInvocationInput {
  readonly rewrite: string;
}

export type CodemodPreviewInvocationInput =
  | PatternCodemodPreviewInvocationInput
  | InlineRuleSearchInvocationInput
  | RuleFileSearchInvocationInput
  | ProjectRulesSearchInvocationInput;

export type CodemodApplyInvocationInput = CodemodPreviewInvocationInput;

export function buildOutlineArgv(input: OutlineInvocationInput): string[] {
  const args = ["outline", "--json=stream", "--color=never"];
  pushLanguageAndConfig(args, input.language, input.sgConfigPath);
  if (input.items !== undefined) args.push("--items", validateValue("items", input.items));
  if (input.view !== undefined) args.push("--view", validateValue("view", input.view));
  if (input.match !== undefined) args.push("--match", validateValue("match", input.match));
  if (input.types !== undefined && input.types.length > 0) {
    args.push("--type", input.types.map((type) => validateValue("type", type)).join(","));
  }
  if (input.publicMembers === true) args.push("--pub-members");
  pushTraversal(args, input.globs, input.follow);
  pushPaths(args, input.cwd, input.paths);
  return args;
}

export function buildSearchArgv(input: SearchInvocationInput): string[] {
  const kind = input.queryKind ?? "pattern";
  let args: string[];
  switch (kind) {
    case "pattern": {
      const patternInput = input as PatternSearchInvocationInput;
      const pattern = validateValue("pattern", patternInput.pattern);
      // clap treats a separate literal "--" as end-of-options, not as this
      // option's value. Use the equals form for that valid pattern.
      const patternArgs = pattern === "--" ? ["--pattern=--"] : ["--pattern", pattern];
      args = [
        "run", ...patternArgs,
        "--json=stream", "--color=never", "--lang", validateValue("language", patternInput.language),
      ];
      pushConfig(args, patternInput.sgConfigPath);
      break;
    }
    case "inline_rule": {
      const ruleInput = input as InlineRuleSearchInvocationInput;
      args = ["scan", "--inline-rules", validateValue("inlineRule", ruleInput.inlineRule), "--json=stream", "--color=never"];
      pushConfig(args, ruleInput.sgConfigPath);
      break;
    }
    case "rule_file": {
      const ruleInput = input as RuleFileSearchInvocationInput;
      args = [
        "scan", "--rule", resolveProjectInput(ruleInput.cwd, validateValue("ruleFile", ruleInput.ruleFile)),
        "--json=stream", "--color=never",
      ];
      pushConfig(args, ruleInput.sgConfigPath);
      break;
    }
    case "project_rules": {
      const projectInput = input as ProjectRulesSearchInvocationInput;
      args = ["scan", "--json=stream", "--color=never", "--config", validateValue("sgConfigPath", projectInput.sgConfigPath)];
      if (projectInput.ruleFilter !== undefined) args.push("--filter", validateValue("ruleFilter", projectInput.ruleFilter));
      break;
    }
    default:
      throw new Error(`unsupported queryKind: ${String(kind)}`);
  }
  pushTraversal(args, input.globs, input.follow);
  pushPaths(args, input.cwd, input.paths);
  return args;
}

export function buildInspectArgv(input: InspectInvocationInput): string[] {
  const args = buildSearchArgv(input);
  // The pattern itself may literally be "--". The path separator is always the
  // final "--" inserted by pushPaths, so search from the end.
  const separator = args.lastIndexOf("--");
  if (separator < 0) throw new Error("internal error: inspect argv has no path separator");
  args.splice(separator, 0, `--debug-query=${input.mode}`);
  return args;
}

/** Build a preview-only invocation. This function never emits an apply or interactive flag. */
export function buildCodemodPreviewArgv(input: CodemodPreviewInvocationInput): string[] {
  const args = buildSearchArgv(input);
  if ((input.queryKind ?? "pattern") !== "pattern") return args;
  const jsonIndex = args.indexOf("--json=stream");
  if (jsonIndex < 0) throw new Error("internal error: codemod preview argv has no JSON output flag");
  args.splice(jsonIndex, 0, "--rewrite", validateValue("rewrite", (input as PatternCodemodPreviewInvocationInput).rewrite));
  return args;
}

/** Build one closed native mutation argv with exactly one update-all flag. */
export function buildCodemodApplyArgv(input: CodemodApplyInvocationInput): string[] {
  const kind = input.queryKind ?? "pattern";
  let args: string[];
  switch (kind) {
    case "pattern": {
      const patternInput = input as PatternCodemodPreviewInvocationInput;
      const pattern = validateValue("pattern", patternInput.pattern);
      const patternArgs = pattern === "--" ? ["--pattern=--"] : ["--pattern", pattern];
      args = [
        "run",
        ...patternArgs,
        "--rewrite", validateValue("rewrite", patternInput.rewrite),
        "--lang", validateValue("language", patternInput.language),
      ];
      pushConfig(args, patternInput.sgConfigPath);
      break;
    }
    case "inline_rule": {
      const ruleInput = input as InlineRuleSearchInvocationInput;
      args = ["scan", "--inline-rules", validateValue("inlineRule", ruleInput.inlineRule)];
      pushConfig(args, ruleInput.sgConfigPath);
      break;
    }
    case "rule_file": {
      const ruleInput = input as RuleFileSearchInvocationInput;
      args = ["scan", "--rule", resolveProjectInput(ruleInput.cwd, validateValue("ruleFile", ruleInput.ruleFile))];
      pushConfig(args, ruleInput.sgConfigPath);
      break;
    }
    case "project_rules": {
      const projectInput = input as ProjectRulesSearchInvocationInput;
      args = ["scan", "--config", validateValue("sgConfigPath", projectInput.sgConfigPath)];
      if (projectInput.ruleFilter !== undefined) args.push("--filter", validateValue("ruleFilter", projectInput.ruleFilter));
      break;
    }
    default:
      throw new Error(`unsupported queryKind: ${String(kind)}`);
  }
  pushTraversal(args, input.globs, input.follow);
  args.push("-U");
  pushPaths(args, input.cwd, input.paths);
  return args;
}

export function buildRuleTestArgv(input: RuleTestInvocationInput): string[] {
  return [
    "test",
    "--config", validateValue("configPath", input.configPath),
    "--test-dir", validateValue("testDir", input.testDir),
    "--skip-snapshot-tests",
    "--color=never",
  ];
}

export function buildProjectRuleDiscoveryArgv(input: ProjectRuleDiscoveryInvocationInput): string[] {
  const args = [
    "scan",
    "--inspect=entity",
    "--json=stream",
    "--color=never",
    "--max-results", "1",
    "--globs", "!**/*",
    "--config", validateValue("sgConfigPath", input.sgConfigPath),
  ];
  if (input.ruleFilter !== undefined) args.push("--filter", validateValue("ruleFilter", input.ruleFilter));
  pushPaths(args, input.cwd, ["."]);
  return args;
}

function pushLanguageAndConfig(args: string[], language: string | undefined, config: string | undefined): void {
  if (language !== undefined) args.push("--lang", validateValue("language", language));
  pushConfig(args, config);
}

function pushConfig(args: string[], config: string | undefined): void {
  if (config !== undefined) args.push("--config", validateValue("sgConfigPath", config));
}

function pushTraversal(args: string[], globs: readonly string[] | undefined, follow: boolean | undefined): void {
  for (const glob of globs ?? []) args.push("--globs", validateValue("glob", glob));
  if (follow === true) args.push("--follow");
}

function pushPaths(args: string[], cwd: string, paths: readonly string[] | undefined): void {
  const targets = paths === undefined || paths.length === 0 ? ["."] : paths;
  args.push("--", ...targets.map((path) => resolveProjectInput(cwd, path)));
}

export function validateArgValue(name: string, value: string): string {
  return validateValue(name, value);
}

function validateValue(name: string, value: string): string {
  if (typeof value !== "string" || value.length === 0) throw new Error(`${name} must not be empty`);
  if (value.includes("\0")) throw new Error(`${name} must not contain NUL bytes`);
  return value;
}
