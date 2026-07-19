# Focus Rail decisions

## Accepted for the scaffold

1. **Blend in by default.** Normal sessions show no label, widget, badge, or startup message.
2. **Do not register a checkpoint tool yet.** A model-callable tool would create visible tool rows and encourage policy narration.
3. **Do not infer semantic progress from tool calls.** A successful command is evidence about that command, not proof that the user's task is complete.
4. **Do not rewrite finalized assistant messages.** Rewriting can damage code, diffs, logs, citations, and structured output.
5. **Do not force user next actions.** If Pi completed the work, the response should end with the result.
6. **Keep evaluation outside normal sessions.** Diagnostics and comparison scenarios are development surfaces, not runtime UI.

## Open decisions for evaluation

- Whether any persistent task state improves outcomes enough to justify additional prompt context.
- Whether `strict` should remain a mode or become a one-turn command.
- Whether a compact UI should exist only while blocked.
- Whether an invisible checkpoint mechanism is possible without hiding material model activity from the user.
- Which models benefit from the policy and which already behave this way without it.
- Whether policy diagnostics should remain offline or be available through an explicit command.
