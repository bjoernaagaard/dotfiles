/**
 * Central tool_call policy gate for non-read Dagster tools.
 * Blocks hard denies only; confirm is handled in tool execute.
 */
import type { ToolCallEvent, ToolCallEventResult, ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { DagsterRuntime } from "../runtime.ts";
import { getToolMeta } from "../tools/catalog.ts";
import { assertAllowed } from "./risk.ts";
import { refineToolRisk } from "./mutation-risk.ts";
import type { RiskClass } from "./types.ts";

/**
 * Pure handler body — unit-testable without full ExtensionAPI.
 */
export function evaluateToolCallPolicy(input: {
  toolName: string;
  toolInput: unknown;
  policy: ReturnType<DagsterRuntime["getEffectivePolicy"]>;
  hasUI: boolean;
}): ToolCallEventResult | undefined {
  const meta = getToolMeta(input.toolName);
  if (!meta) return undefined;

  // Only gate our catalog tools that are above read (or refined above read).
  const risk: RiskClass = refineToolRisk(input.toolName, input.toolInput, meta.risk);
  if (risk === "read") return undefined;

  const force =
    input.toolInput &&
    typeof input.toolInput === "object" &&
    "force" in (input.toolInput as object)
      ? Boolean((input.toolInput as { force?: boolean }).force)
      : false;

  const decision = assertAllowed({
    risk,
    policy: input.policy,
    hasUI: input.hasUI,
    force,
  });

  if (decision === "block") {
    return {
      block: true,
      reason: `Blocked by policy: risk=${risk} policy=${input.policy}`,
    };
  }

  // confirm → allow through; tool execute will confirm.
  return undefined;
}

/**
 * Register-ready handler for pi.on("tool_call", …).
 */
export function createToolCallPolicyHandler(runtime: DagsterRuntime) {
  return async (
    event: ToolCallEvent,
    ctx: ExtensionContext,
  ): Promise<ToolCallEventResult | undefined> => {
    if (runtime.closed) {
      return { block: true, reason: "Dagster runtime is shut down" };
    }
    return evaluateToolCallPolicy({
      toolName: event.toolName,
      toolInput: event.input,
      policy: runtime.getEffectivePolicy(),
      hasUI: Boolean(ctx.hasUI),
    });
  };
}
