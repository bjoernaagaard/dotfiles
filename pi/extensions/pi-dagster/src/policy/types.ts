/** Risk classes for Dagster tools (proposal §6.1). */
export type RiskClass =
  | "read"
  | "local_source"
  | "local_exec"
  | "remote_launch"
  | "remote_state"
  | "destructive"
  | "secret"
  | "infra";

/** Profile-level mutation policy. */
export type ProfilePolicy = "readOnly" | "confirmMutations" | "allowMutations";

/** Entity kinds indexed by the tool catalog. */
export type EntityKind =
  | "asset"
  | "run"
  | "job"
  | "schedule"
  | "sensor"
  | "backfill"
  | "instance"
  | "project"
  | "graphql"
  | "dg";

/** Offline catalog metadata (not LLM schema). */
export type ToolMeta = {
  name: string;
  risk: RiskClass;
  entities: EntityKind[];
  verbs: string[];
  graphqlFields?: string[];
  dgCommands?: string[];
  keywords: string[];
  /** Short description used by the search ranker. */
  description: string;
  /** Whether the tool is always active at session_start. */
  alwaysOn: boolean;
};

export type PolicyDecision = "allow" | "confirm" | "block";

export type AssertAllowedInput = {
  risk: RiskClass;
  policy: ProfilePolicy;
  hasUI: boolean;
  force?: boolean;
};
