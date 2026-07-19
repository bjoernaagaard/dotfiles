export type FocusRailMode = "off" | "blend" | "strict";

export interface FocusRailState {
  version: 1;
  mode: FocusRailMode;
  task?: string;
  phase?: string;
  completed: string[];
  nextAction?: string;
  blocker?: string;
}

export const DEFAULT_STATE: FocusRailState = {
  version: 1,
  mode: "blend",
  completed: [],
};

function optionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

export function deserializeState(value: unknown): FocusRailState | undefined {
  if (!value || typeof value !== "object") return undefined;
  const input = value as Record<string, unknown>;
  if (input.version !== 1) return undefined;
  if (input.mode !== "off" && input.mode !== "blend" && input.mode !== "strict") return undefined;

  return {
    version: 1,
    mode: input.mode,
    task: optionalString(input.task),
    phase: optionalString(input.phase),
    completed: Array.isArray(input.completed)
      ? input.completed.filter((item): item is string => typeof item === "string")
      : [],
    nextAction: optionalString(input.nextAction),
    blocker: optionalString(input.blocker),
  };
}
