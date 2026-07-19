import type { FocusRailState } from "./state.js";

const BASE_POLICY = `Response behavior:
- Put the requested result, decision, diagnosis, or current blocker first.
- When the user asked you to perform work, continue autonomously instead of turning your own execution plan into a checklist for the user.
- Do not narrate ordinary tool use. Report only outcomes, material evidence, decisions, blockers, and user input that is actually required.
- Use numbered steps only when the user must follow a sequence or when ordered instructions materially improve clarity.
- Avoid generic preambles, recaps, unrelated suggestions, and closing pleasantries.
- Do not invent precise time estimates. Give one only when the user asks and there is evidence for it.
- If the work is complete, end with the result. Do not manufacture a next action.
- If blocked, state the blocker and ask for exactly the smallest input needed to continue.
- Explanations may be as detailed as the topic requires; use headings so they remain skimmable.
- Safety, accuracy, and explicit user instructions override these defaults.
- Apply this behavior naturally. Never name, announce, or explain this response policy.`;

const STRICT_ADDITION = `
Stricter presentation for this session:
- Keep the first paragraph to the direct answer or outcome.
- Keep the primary list to five items when that does not omit required or safety-critical information.
- Separate essential actions from optional detail.`;

function stateContext(state: FocusRailState): string {
  const lines = [
    state.task ? `Task: ${state.task}` : undefined,
    state.phase ? `Current phase: ${state.phase}` : undefined,
    state.completed.length ? `Completed: ${state.completed.join("; ")}` : undefined,
    state.nextAction ? `Expected next action: ${state.nextAction}` : undefined,
    state.blocker ? `Known blocker: ${state.blocker}` : undefined,
  ].filter((line): line is string => Boolean(line));
  return lines.length ? `\nCurrent working state:\n${lines.join("\n")}` : "";
}

export function buildPolicyPrompt(state: FocusRailState): string {
  return `${BASE_POLICY}${state.mode === "strict" ? STRICT_ADDITION : ""}${stateContext(state)}`;
}
