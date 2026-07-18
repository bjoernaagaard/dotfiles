import { defineTool } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import type { DagsterRuntime } from "../../runtime.ts";
import {
  assertDgAllowlisted,
  assertNotDevViaCommandTool,
  classifyDgArgs,
  formatDgArgvSummary,
} from "../../clients/dg.ts";
import { assertAllowed } from "../../policy/risk.ts";
import { attachSafeRenderers } from "../../render/index.ts";

/**
 * Real lazy tool: allowlisted local `dg` CLI.
 * Lazy tools MUST omit promptSnippet / promptGuidelines.
 *
 * Option A: `dg dev` is rejected — use `/dagster-dev` / runtime.startDgDev.
 */
export function createDgCommandTool(runtime: DagsterRuntime) {
  return attachSafeRenderers(defineTool({
    name: "dagster_dg_command",
    label: "dg Command",
    description:
      "Run an allowlisted local dg CLI command (check, list, scaffold, launch). " +
      "cwd defaults to profile.projectRoot or discovered project root. " +
      "Run `dg check` after source/config changes and use official scaffold forms only; for `dg dev` lifecycle use /dagster-dev. Non-zero exit returns structured output (not throw), not a transport failure.",
    // Intentionally no promptSnippet / promptGuidelines.
    parameters: Type.Object({
      args: Type.Array(Type.String(), {
        minItems: 1,
        description:
          'Allowlisted dg subcommand and args, e.g. ["check","defs"], ["list","defs"], or ["scaffold","defs",...]; never use ["dev",...].',
      }),
      cwd: Type.Optional(
        Type.String({ description: "Override working directory" }),
      ),
      timeoutMs: Type.Optional(Type.Number()),
      force: Type.Optional(
        Type.Boolean({
          description:
            "Bypass confirm when policy requires force in non-UI modes",
        }),
      ),
    }),
    async execute(_toolCallId, params, signal, _onUpdate, ctx) {
      if (signal?.aborted) throw new Error("Aborted");
      if (runtime.closed) throw new Error("Dagster runtime is shut down");

      const args = params.args.map(String);
      // Fail fast with clear remediation before policy.
      assertDgAllowlisted(args);
      assertNotDevViaCommandTool(args);

      const risk = classifyDgArgs(args);
      const policy = runtime.getEffectivePolicy();
      const hasUI = Boolean(ctx?.hasUI);
      const decision = assertAllowed({
        risk,
        policy,
        hasUI,
        force: Boolean(params.force),
      });

      if (decision === "block") {
        throw new Error(
          `Blocked by policy: risk=${risk} policy=${policy}` +
            (hasUI ? "" : " (non-UI: pass force=true when allowed)"),
        );
      }
      if (decision === "confirm") {
        if (!ctx?.ui?.confirm) {
          throw new Error(
            `Confirmation required for ${risk} but no UI available. Pass force=true in print/json when policy allows.`,
          );
        }
        const ok = await ctx.ui.confirm(
          "Confirm local dg command",
          `Run dg ${args.join(" ")} (risk=${risk})?`,
        );
        if (!ok) {
          throw new Error("User declined dg command");
        }
      }

      const cwd =
        params.cwd?.trim() ||
        (await runtime.getProjectRoot(ctx?.cwd ?? process.cwd()));

      let result;
      try {
        result = await runtime.runDg({
          args,
          cwd,
          signal: signal ?? ctx?.signal,
          timeoutMs: params.timeoutMs,
        });
      } catch (err) {
        // Spawn failure / abort / timeout / binary missing → throw
        throw err instanceof Error ? err : new Error(String(err));
      }

      const lines = [
        `argv: ${formatDgArgvSummary(result.argv)}`,
        `cwd: ${result.cwd}`,
        `exitCode: ${result.exitCode}`,
        `durationMs: ${result.durationMs}`,
        result.truncated ? `truncated: true` : null,
        result.stdoutPath ? `stdoutPath: ${result.stdoutPath}` : null,
        result.stderrPath ? `stderrPath: ${result.stderrPath}` : null,
        "",
        "--- stdout ---",
        result.stdout || "(empty)",
        "",
        "--- stderr ---",
        result.stderr || "(empty)",
      ].filter((x) => x !== null) as string[];

      return {
        content: [{ type: "text", text: lines.join("\n") }],
        details: {
          kind: result.exitCode === 0 ? "dg_ok" : "dg_exit",
          argv: result.argv,
          cwd: result.cwd,
          exitCode: result.exitCode,
          signal: result.signal,
          truncated: result.truncated,
          stdoutPath: result.stdoutPath,
          stderrPath: result.stderrPath,
          durationMs: result.durationMs,
          risk,
          // Never include env secrets.
        },
      };
    },
  }));
}
