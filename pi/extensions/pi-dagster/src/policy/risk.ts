import type { AssertAllowedInput, PolicyDecision, ProfilePolicy, RiskClass } from "./types.ts";

/** Ordered severity for coarse policy comparisons (readOnly blocks above read). */
const RISK_RANK: Record<RiskClass, number> = {
  read: 0,
  local_source: 1,
  local_exec: 2,
  remote_launch: 3,
  remote_state: 4,
  destructive: 5,
  secret: 6,
  infra: 7,
};

/**
 * Decide whether a tool call may proceed.
 *
 * - readOnly profiles block anything above `read`
 * - destructive always requires confirm when UI is present; without UI, block unless force
 * - non-read risks under confirmMutations require confirm when UI is present; block without UI unless force
 * - allowMutations still forces confirm for destructive when UI is present
 */
export function assertAllowed(input: AssertAllowedInput): PolicyDecision {
  const { risk, policy, hasUI, force = false } = input;

  if (policy === "readOnly" && RISK_RANK[risk] > RISK_RANK.read) {
    return "block";
  }

  if (risk === "destructive") {
    if (hasUI) return "confirm";
    return force ? "allow" : "block";
  }

  if (risk === "secret") {
    // Secret values never go to the LLM; block tool path unless force + UI later phases.
    return force && hasUI ? "confirm" : "block";
  }

  if (risk === "read") {
    return "allow";
  }

  // Non-read, non-destructive under remaining policies
  if (policy === "allowMutations") {
    return "allow";
  }

  // confirmMutations (default posture for mutating classes)
  if (hasUI) return "confirm";
  return force ? "allow" : "block";
}

export function riskRank(risk: RiskClass): number {
  return RISK_RANK[risk];
}

export function isAboveRead(risk: RiskClass): boolean {
  return RISK_RANK[risk] > RISK_RANK.read;
}

export function defaultPolicy(): ProfilePolicy {
  return "confirmMutations";
}
