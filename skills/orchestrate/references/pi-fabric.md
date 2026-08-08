# Pi Fabric adapter

Use this reference only when Pi Fabric provides the agent runtime. Treat the installed tool schemas and `docs/agents.md` as the source of truth.

## Approved groundwork pool

These four model identifiers are a user-authored cost policy:

- `openai-codex/gpt-5.6-luna`
- `openai-codex/gpt-5.6-terra`
- `xai/grok-4.5`
- `deepseek-responses/deepseek-v4-flash`

Before dispatch, compare this approved pool with the keys from `tools.models()`. Select only an available approved key. Pass it explicitly as `model` on every delegated groundwork request. An omitted model may inherit Main’s expensive model. When no approved model can perform an item, return control to the user before dispatch. Use another model only after explicit user approval. Setting `agents.model` to one pool member is an additional default, not a replacement for explicit selection.

## Dispatch

- Use `agents.run()` for blocking work. Use `agents.spawn()` when Main has useful work before reconciliation, then `agents.wait({ id })` when the result is needed. Detached runs already notify Main on completion when configured.
- Batch independent calls in one `fabric_exec` with `Promise.all`. Set `agentBudget` and `tokenBudget` on that execution when bounds are needed.
- Pi Fabric's effort field is `thinking`: `"low"` for narrow scouts, `"medium"` for routine work, and `"high"` for hard work. The harness can reduce an unsupported effort level.
- Omit `timeoutMs` unless the work needs longer than the configured agent timeout.

## Capability and ownership

- A read-only scout uses `tools: ["read", "grep", "find", "ls"]` and usually `extensions: false`. The tool allowlist creates read-only behavior; `extensions: false` separately removes recursive Fabric access.
- Give leaf workers self-contained tasks and `recursive: false` or `extensions: false`. Use `recursive: true` or `rlm.query()` only for an explicitly recursive partition and only with a Pi runner.
- For concurrent writers, prefer `worktree: true` with disjoint path ownership. Worktrees require explicit integration and `agents.cleanup()`; creation does not merge changes.
- Keep user approvals in Main. Recursive children inherit agent coordination approval, not network, execution, or write approvals.

## Lifecycle and evidence

- Normalize terminal results as `completed`, `failed`, `stopped`, or `timed_out`; distinguish a launch error from a launched worker's terminal result.
- Prefer `agents.steer()` when redirection preserves useful context. Use `agents.stop()` when replacement is cheaper.
- Track background work by handle, status, and logs. Use lifecycle subscriptions for cross-participant events instead of model-authored polling.
- Verify the combined workspace after integration. Worker completion is evidence about an item, not proof of the overall outcome.
