/**
 * Execute-time policy gate for mutating tools (defense in depth after tool_call).
 */
import type { RiskClass, ProfilePolicy, PolicyDecision } from "./types.ts";
import { assertAllowed } from "./risk.ts";

export type ConfirmUi = {
  confirm?: (title: string, message: string) => Promise<boolean>;
};

export type EnforceMutationInput = {
  risk: RiskClass;
  policy: ProfilePolicy;
  hasUI: boolean;
  force?: boolean;
  /** Short title for confirm dialog */
  title: string;
  /** Body for confirm dialog — must not contain secrets */
  message: string;
  ui?: ConfirmUi;
};

/**
 * Gate a mutation. Throws on block or user decline.
 * Returns the decision taken ("allow" after confirm).
 */
export async function enforceMutation(
  input: EnforceMutationInput,
): Promise<PolicyDecision> {
  const decision = assertAllowed({
    risk: input.risk,
    policy: input.policy,
    hasUI: input.hasUI,
    force: Boolean(input.force),
  });

  if (decision === "block") {
    throw new Error(
      `Blocked by policy: risk=${input.risk} policy=${input.policy}` +
        (input.hasUI ? "" : " (non-UI: pass force=true when allowed)"),
    );
  }

  if (decision === "confirm") {
    if (!input.ui?.confirm) {
      throw new Error(
        `Confirmation required for ${input.risk} but no UI available. Pass force=true in print/json when policy allows.`,
      );
    }
    const ok = await input.ui.confirm(input.title, input.message);
    if (!ok) {
      throw new Error("User declined mutation");
    }
  }

  return decision === "confirm" ? "allow" : decision;
}

export function policyBlockMessage(risk: RiskClass, policy: ProfilePolicy): string {
  return `Blocked by policy: risk=${risk} policy=${policy}`;
}
