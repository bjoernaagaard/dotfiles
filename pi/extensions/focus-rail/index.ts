import type {
  ExtensionAPI,
  ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import { buildPolicyPrompt } from "./src/policy.js";
import {
  DEFAULT_STATE,
  deserializeState,
  type FocusRailMode,
  type FocusRailState,
} from "./src/state.js";

const STATE_ENTRY_TYPE = "focus-rail-state";

function modeFromEnvironment(): FocusRailMode | undefined {
  const value = process.env.PI_FOCUS_RAIL?.trim().toLowerCase();
  if (value === "off" || value === "blend" || value === "strict") return value;
  return undefined;
}

function restoreState(ctx: ExtensionContext): FocusRailState {
  const branch = ctx.sessionManager.getBranch();
  for (let index = branch.length - 1; index >= 0; index -= 1) {
    const entry = branch[index];
    if (entry?.type !== "custom" || entry.customType !== STATE_ENTRY_TYPE) continue;
    const restored = deserializeState(entry.data);
    if (restored) return restored;
  }
  return { ...DEFAULT_STATE, completed: [] };
}

function summary(state: FocusRailState): string {
  const lines = [`Rail: ${state.mode}`];
  if (state.task) lines.push(`Task: ${state.task}`);
  if (state.phase) lines.push(`Now: ${state.phase}`);
  if (state.nextAction) lines.push(`Next: ${state.nextAction}`);
  if (state.blocker) lines.push(`Blocked: ${state.blocker}`);
  return lines.join("\n");
}

export default function focusRail(pi: ExtensionAPI): void {
  let state: FocusRailState = { ...DEFAULT_STATE, completed: [] };
  const environmentMode = modeFromEnvironment();

  const persist = (): void => {
    pi.appendEntry(STATE_ENTRY_TYPE, state);
  };

  const setMode = (mode: FocusRailMode): void => {
    state = { ...state, mode };
    persist();
  };

  pi.registerCommand("rail", {
    description: "Adjust the session response style",
    getArgumentCompletions: (prefix) => {
      const values = ["status", "on", "off", "strict", "reset"];
      const matches = values.filter((value) => value.startsWith(prefix));
      return matches.length ? matches.map((value) => ({ value, label: value })) : null;
    },
    handler: async (args, ctx) => {
      const action = args.trim().toLowerCase() || "status";
      if (action === "on") setMode("blend");
      else if (action === "off") setMode("off");
      else if (action === "strict") setMode("strict");
      else if (action === "reset") {
        state = { ...DEFAULT_STATE, completed: [] };
        persist();
      } else if (action !== "status") {
        ctx.ui.notify("Usage: /rail [status|on|off|strict|reset]", "warning");
        return;
      }
      ctx.ui.notify(summary(state), "info");
    },
  });

  pi.on("session_start", (_event, ctx) => {
    state = restoreState(ctx);
    if (environmentMode) state = { ...state, mode: environmentMode };
  });

  pi.on("before_agent_start", (event) => {
    if (state.mode === "off") return;
    return {
      systemPrompt: `${event.systemPrompt}\n\n${buildPolicyPrompt(state)}`,
    };
  });
}
