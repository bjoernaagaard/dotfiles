# Focus Rail

A quiet, adaptive response policy for Pi. It changes how the agent structures work without adding a visible mode to ordinary sessions.

## Default behavior

- Active in `blend` mode.
- No model-callable tools.
- No status badge, widget, startup notification, or automatic chat message.
- No narration of ordinary tool use.
- No mention of Focus Rail or its policy in assistant responses.
- Session state is persisted only after an explicit `/rail` change.

The only visible control surface is user-invoked:

```text
/rail status
/rail on
/rail off
/rail strict
/rail reset
```

For an isolated process, override the mode with `PI_FOCUS_RAIL=off|blend|strict`.

## Development

```bash
npm install
npm run check
npm run eval:prompts
```

The extension is auto-discovered from this directory through the managed `~/.pi/agent/extensions` symlink. Use `/reload` in an existing Pi session after changing it.

## Evaluation

`eval/scenarios.ts` contains the initial comparison set. The intended experiment is matched pairs of fresh Pi sessions:

1. Baseline: `PI_FOCUS_RAIL=off pi`
2. Treatment: `PI_FOCUS_RAIL=blend pi`
3. Give both sessions the same scenario.
4. Capture only the final response.
5. Compare task ownership, directness, completeness, safety, policy leakage, and unnecessary user handoff.

Use different Pi model configurations for model comparisons. Other agent runtimes such as Claude Code or Codex do not load a Pi-native extension and are not directly comparable unless the same policy is injected separately.
