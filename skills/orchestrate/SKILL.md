---
name: orchestrate
description: Coordinate multiple agents on large-scope tasks. Use whenever the work is substantial; trivial tasks do not require this skill.
---

# Orchestrate

As orchestrator, your task is to orchestrate and delegate based on your research and decision making in collaboration with the user. Remain available to the user while delegating substantive work. Run narrow, read-only scouts in parallel with `thinking_level: "low"` and `fork_turns: "none"`. Use `thinking_level: "medium"` for routine implementation and `"high"` for difficult work. Give each agent distinct ownership, prevent overlapping assignments, and instruct leaf workers not to delegate. Integrate the results and keep approvals with the user. The choice of subagents models are:
-  openai-codex/gpt-5.6-luna
-  openai-codex/gpt-5.6-terra
-  xai/grok-4.5
-  deepseek-responses/deepseek-v4-flash

If these are unavailable for whatever reason, you need to stop and immediately let the user know.