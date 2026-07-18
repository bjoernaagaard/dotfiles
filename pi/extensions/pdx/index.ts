import { StringEnum } from "@earendil-works/pi-ai";
import {
  type ExtensionAPI,
  type ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import { Text } from "@earendil-works/pi-tui";
import { Type, type Static } from "typebox";
import { loadConfig } from "./src/config.js";
import {
  BOOTSTRAP_PARTS,
  executeMiseBootstrap,
} from "./src/bootstrap.js";
import { executeMise, miseNeedsConfirmation } from "./src/mise.js";
import {
  assertFnoxPolicy,
  fnoxSecretCommand,
  runFnoxExec,
} from "./src/fnox-runner.js";
import { executePitchfork, pitchforkStatus } from "./src/pitchfork.js";
import { commandDetails, formatCommandResult, lastLine } from "./src/output.js";
import { findExecutable, parseJsonOutput, runCommand } from "./src/runner.js";
import {
  discoverMiseBootstrap,
  formatMiseBootstrapPrompt,
  formatMiseBootstrapStatus,
  type MiseBootstrapDiscovery,
} from "./src/discovery.js";
import type { PdxConfig, PdxSecretDetails, PdxToolDetails } from "./src/types.js";

const PitchforkParameters = Type.Object({
  action: StringEnum(["status", "start", "stop", "restart", "logs"] as const),
  ids: Type.Optional(Type.Array(Type.String({ minLength: 1 }), { minItems: 1 })),
  force: Type.Optional(Type.Boolean()),
  lines: Type.Optional(Type.Integer({ minimum: 0, maximum: 2000 })),
}, { additionalProperties: false });

const MiseParameters = Type.Object({
  action: StringEnum(["tools", "tasks", "env", "config", "run", "install"] as const),
  task: Type.Optional(Type.String({ minLength: 1 })),
  args: Type.Optional(Type.Array(Type.String())),
  tool: Type.Optional(Type.String({ minLength: 1 })),
  version: Type.Optional(Type.String({ minLength: 1 })),
  includeValues: Type.Optional(Type.Boolean()),
  timeoutMs: Type.Optional(Type.Integer({ minimum: 1000, maximum: 600000 })),
}, { additionalProperties: false });

const MiseBootstrapParameters = Type.Object({
  action: StringEnum(["status", "plan", "apply"] as const),
  only: Type.Optional(Type.Array(StringEnum(BOOTSTRAP_PARTS), { minItems: 1, maxItems: BOOTSTRAP_PARTS.length })),
  skip: Type.Optional(Type.Array(StringEnum(BOOTSTRAP_PARTS), { minItems: 1, maxItems: BOOTSTRAP_PARTS.length })),
  update: Type.Optional(Type.Boolean()),
  forceDotfiles: Type.Optional(Type.Boolean()),
  timeoutMs: Type.Optional(Type.Integer({ minimum: 1000, maximum: 600000 })),
}, { additionalProperties: false });

const FnoxExecParameters = Type.Object({
  command: Type.Array(Type.String(), { minItems: 1, description: "Program and arguments; no shell is invoked" }),
  profile: Type.Optional(Type.String({ minLength: 1 })),
  timeoutMs: Type.Optional(Type.Integer({ minimum: 1000, maximum: 600000 })),
}, { additionalProperties: false });

const FnoxSecretParameters = Type.Object({
  name: Type.String({ minLength: 1, description: "One exact fnox secret name" }),
  profile: Type.Optional(Type.String({ minLength: 1 })),
}, { additionalProperties: false });

type PitchforkParams = Static<typeof PitchforkParameters>;
type FnoxExecParams = Static<typeof FnoxExecParameters>;
type FnoxSecretParams = Static<typeof FnoxSecretParameters>;

function progressFor(
  onUpdate: unknown,
): (text: string) => void {
  const update = onUpdate as ((partial: {
    content: [{ type: "text"; text: string }];
    details: { progress: string };
  }) => void) | undefined;
  let lastAt = 0;
  let lastText = "";
  return (text: string) => {
    const now = Date.now();
    if (text === lastText || now - lastAt < 250) return;
    lastAt = now;
    lastText = text;
    update?.({ content: [{ type: "text", text }], details: { progress: text } });
  };
}

async function confirm(
  ctx: ExtensionContext,
  required: boolean,
  title: string,
  body: string,
): Promise<void> {
  if (!required) return;
  if (!ctx.hasUI) throw new Error(`pdx: ${title} requires confirmation, but no UI is available`);
  if (!(await ctx.ui.confirm(title, body))) throw new Error("pdx: operation cancelled by user");
}

function ensureEnabled(config: PdxConfig): void {
  if (!config.enabled) throw new Error("pdx is disabled by configuration");
}

function pitchforkMutation(action: PitchforkParams["action"]): boolean {
  return action === "start" || action === "stop" || action === "restart";
}

function renderCall(args: Record<string, unknown>, theme: Parameters<NonNullable<Parameters<ExtensionAPI["registerTool"]>[0]["renderCall"]>>[1]): Text {
  const action = typeof args.action === "string" ? args.action : "operation";
  return new Text(theme.fg("toolTitle", theme.bold(`pdx ${action}`)), 0, 0);
}

function renderResult(
  result: { details?: unknown; content: readonly { type: string; text?: string }[] },
  options: { expanded: boolean },
  theme: Parameters<NonNullable<Parameters<ExtensionAPI["registerTool"]>[0]["renderResult"]>>[2],
): Text {
  const details = result.details as PdxToolDetails | undefined;
  if (details?.kind === "secret") {
    return new Text(theme.fg("warning", `fnox secret ${details.name}: value returned to the model (hidden in UI)`), 0, 0);
  }
  if (details?.kind === "command") {
    const status = details.code === 0 ? theme.fg("success", "✓") : theme.fg("error", `exit ${details.code ?? "?"}`);
    let text = `${status} ${details.service} ${details.action} (${details.durationMs}ms)`;
    if (details.truncated) text += ` ${theme.fg("warning", "[truncated]")}`;
    if (options.expanded) {
      const output = [details.stdout.trimEnd(), details.stderr.trimEnd()].filter(Boolean).join("\nstderr:\n");
      if (output) text += `\n${theme.fg("dim", output)}`;
    }
    return new Text(text, 0, 0);
  }
  const fallback = result.content.map((part) => part.text ?? "").join("\n");
  return new Text(theme.fg("muted", fallback), 0, 0);
}

async function executeFnoxSecret(
  ctx: ExtensionContext,
  params: FnoxSecretParams,
  config: PdxConfig,
): Promise<{ content: [{ type: "text"; text: string }]; details: PdxToolDetails }> {
  if (/\s/.test(params.name)) throw new Error("pdx_fnox_secret: name must not contain whitespace");
  await confirm(
    ctx,
    config.permissionMode === "ask",
    "Expose fnox secret?",
    `This will place '${params.name}' in the agent conversation and session history.`,
  );

  const args = fnoxSecretCommand(params.name, params.profile);
  const result = await runCommand({
    command: "fnox",
    args,
    cwd: ctx.cwd,
    signal: ctx.signal,
    timeoutMs: config.defaultTimeoutMs,
    maxOutputBytes: config.maxOutputBytes,
  });
  if (result.code !== 0) {
    const details = commandDetails("fnox", "get_secret", ["fnox", ...args], result);
    return { content: [{ type: "text", text: formatCommandResult(details) }], details };
  }

  const value = result.stdout.trimEnd();
  const details: PdxSecretDetails = {
    kind: "secret",
    name: params.name,
    ...(params.profile ? { profile: params.profile } : {}),
    retrieved: true,
  };
  return {
    content: [{ type: "text", text: value }],
    details,
  };
}

async function executeFnox(
  ctx: ExtensionContext,
  params: FnoxExecParams,
  config: PdxConfig,
  onUpdate: unknown,
): Promise<{ content: [{ type: "text"; text: string }]; details: PdxToolDetails }> {
  assertFnoxPolicy(params.command);
  await confirm(
    ctx,
    config.permissionMode === "ask",
    "Allow fnox execution?",
    `fnox will inject profile secrets into:\n\n  ${params.command.join(" ")}\n\nWorking directory: ${ctx.cwd}`,
  );

  const progress = progressFor(onUpdate);
  progress(`fnox exec: ${params.command[0]}`);
  const result = await runFnoxExec(
    ctx,
    config,
    params.command,
    params.profile,
    Math.min(params.timeoutMs ?? config.defaultTimeoutMs, 10 * 60_000),
    (text) => progress(`fnox exec: ${lastLine(text)}`),
  );
  const args = [
    "--non-interactive",
    ...(params.profile ? ["-P", params.profile] : []),
    "exec",
    ...params.command,
  ];
  const details = commandDetails("fnox", "exec", ["fnox", ...args], result);
  return {
    content: [{ type: "text", text: formatCommandResult(details) }],
    details,
  };
}

async function doctor(ctx: ExtensionContext): Promise<string> {
  const config = await loadConfig(ctx);
  const [binaries, miseBootstrap] = await Promise.all([
    Promise.all(["pitchfork", "mise", "fnox"].map(async (name) => [name, await findExecutable(name)] as const)),
    discoverMiseBootstrap(ctx, config),
  ]);
  const lines = [
    "pdx doctor",
    "",
    ...binaries.map(([name, path]) => `${path ? "✓" : "✗"} ${name}${path ? `: ${path}` : ": not found"}`),
    formatMiseBootstrapStatus(miseBootstrap),
    `${config.enabled ? "✓" : "✗"} policy: ${config.enabled ? "enabled" : "disabled"}`,
    `permission mode: ${config.permissionMode}`,
    `output limit: ${config.maxOutputBytes} bytes`,
  ];
  return lines.join("\n");
}

async function status(ctx: ExtensionContext): Promise<string> {
  const config = await loadConfig(ctx);
  ensureEnabled(config);
  const [pitchfork, miseBootstrap, miseResult] = await Promise.all([
    pitchforkStatus(ctx, config),
    discoverMiseBootstrap(ctx, config),
    runCommand({
      command: "mise",
      args: ["ls", "--json"],
      cwd: ctx.cwd,
      signal: ctx.signal,
      timeoutMs: config.defaultTimeoutMs,
      maxOutputBytes: config.maxOutputBytes,
    }),
  ]);
  const miseData = parseJsonOutput(miseResult.stdout);
  const miseDetails = commandDetails("mise", "tools", ["mise", "ls", "--json"], miseResult);
  return [pitchfork, "", formatCommandResult(miseDetails, miseData), "", formatMiseBootstrapStatus(miseBootstrap)].join("\n");
}

export default function pdxExtension(pi: ExtensionAPI): void {
  let discoveryCwd: string | undefined;
  let discoveryPromise: Promise<MiseBootstrapDiscovery> | undefined;

  function getMiseBootstrapDiscovery(ctx: ExtensionContext, config: PdxConfig): Promise<MiseBootstrapDiscovery> {
    if (discoveryPromise && discoveryCwd === ctx.cwd) return discoveryPromise;
    discoveryCwd = ctx.cwd;
    discoveryPromise = discoverMiseBootstrap(ctx, config);
    return discoveryPromise;
  }

  pi.registerTool({
    name: "pdx_pitchfork",
    label: "pdx pitchfork",
    description: "Inspect and control pitchfork-managed development daemons. Mutations require confirmation.",
    promptSnippet: "Inspect or control pitchfork daemons without using MCP",
    parameters: PitchforkParameters,
    async execute(_toolCallId, params, _signal, onUpdate, ctx) {
      const config = await loadConfig(ctx);
      ensureEnabled(config);
      await confirm(
        ctx,
        pitchforkMutation(params.action) && config.permissionMode === "ask",
        `Allow pitchfork ${params.action}?`,
        `Daemon ids: ${(params.ids ?? []).join(", ") || "all"}\nWorking directory: ${ctx.cwd}`,
      );
      return executePitchfork(ctx, params, config, progressFor(onUpdate));
    },
    renderCall,
    renderResult,
  });

  pi.registerTool({
    name: "pdx_mise",
    label: "pdx mise",
    description: "Inspect the current mise environment or run a mise task/install under the global pdx permission mode.",
    promptSnippet: "Inspect mise tools, tasks, env, config, or run a controlled task",
    parameters: MiseParameters,
    async execute(_toolCallId, params, _signal, onUpdate, ctx) {
      const config = await loadConfig(ctx);
      ensureEnabled(config);
      await confirm(
        ctx,
        miseNeedsConfirmation(params) && config.permissionMode === "ask",
        `Allow mise ${params.action}?`,
        `Task: ${params.task ?? "n/a"}\nTool: ${params.tool ?? "n/a"}\nWorking directory: ${ctx.cwd}`,
      );
      return executeMise(ctx, params, config, progressFor(onUpdate));
    },
    renderCall,
    renderResult,
  });

  pi.registerTool({
    name: "pdx_mise_bootstrap",
    label: "pdx mise bootstrap",
    description: "Inspect, preview, or apply a targeted mise Bootstrap. Prefer this over generic shell or mise commands for machine setup, dotfiles, packages, repositories, OS preferences, shell activation, and mise-managed tools.",
    promptSnippet: "Use for detected mise Bootstrap machine setup; status, plan, or apply under pdx policy",
    parameters: MiseBootstrapParameters,
    async execute(_toolCallId, params, _signal, onUpdate, ctx) {
      const config = await loadConfig(ctx);
      ensureEnabled(config);
      return executeMiseBootstrap(
        ctx,
        params,
        config,
        progressFor(onUpdate),
        async (title, body) => confirm(ctx, true, title, body),
      );
    },
    renderCall,
    renderResult,
  });

  pi.registerTool({
    name: "pdx_fnox_exec",
    label: "pdx fnox exec",
    description: "Run an argument-array command through fnox with profile secrets injected and output redacted.",
    promptSnippet: "Run a command through fnox without exposing secrets to Pi",
    parameters: FnoxExecParameters,
    async execute(_toolCallId, params, _signal, onUpdate, ctx) {
      const config = await loadConfig(ctx);
      ensureEnabled(config);
      return executeFnox(ctx, params, config, onUpdate);
    },
    renderCall,
    renderResult,
  });

  pi.registerTool({
    name: "pdx_fnox_secret",
    label: "pdx fnox secret",
    description: "Retrieve one explicitly named fnox secret; confirmation follows the global pdx permission mode.",
    promptSnippet: "Retrieve one explicitly named fnox secret only with explicit policy permission",
    parameters: FnoxSecretParameters,
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      const config = await loadConfig(ctx);
      ensureEnabled(config);
      return executeFnoxSecret(ctx, params, config);
    },
    renderCall,
    renderResult,
  });

  pi.registerCommand("pdx", {
    description: "Inspect pdx and its jdx tool integrations",
    getArgumentCompletions: (prefix) => {
      const values = ["doctor", "status"];
      const matches = values.filter((value) => value.startsWith(prefix));
      return matches.length ? matches.map((value) => ({ value, label: value })) : null;
    },
    handler: async (args, ctx) => {
      const action = args.trim() || "doctor";
      const output = action === "status" ? await status(ctx) : action === "doctor" ? await doctor(ctx) : `Unknown pdx command: ${action}`;
      ctx.ui.notify(output, action === "doctor" || action === "status" ? "info" : "error");
    },
  });

  pi.on("session_start", async (_event, ctx) => {
    try {
      const config = await loadConfig(ctx);
      const miseBootstrap = config.enabled ? await getMiseBootstrapDiscovery(ctx, config) : undefined;
      if (ctx.hasUI) {
        ctx.ui.setStatus(
          "pdx",
          !config.enabled ? "pdx disabled" : miseBootstrap?.configured ? "pdx · mise Bootstrap" : "pdx ready",
        );
      }
    } catch (error) {
      if (ctx.hasUI) ctx.ui.notify(error instanceof Error ? error.message : String(error), "warning");
    }
  });

  pi.on("before_agent_start", async (event, ctx) => {
    try {
      const config = await loadConfig(ctx);
      if (!config.enabled) return;
      const miseBootstrap = await getMiseBootstrapDiscovery(ctx, config);
      if (!miseBootstrap.configured) return;
      return { systemPrompt: `${event.systemPrompt}\n\n${formatMiseBootstrapPrompt(miseBootstrap)}` };
    } catch {
      // Discovery is advisory. A failed probe must never block the user's turn.
      return;
    }
  });

  pi.on("session_shutdown", (_event, ctx) => {
    if (ctx.hasUI) ctx.ui.setStatus("pdx", undefined);
  });
}
