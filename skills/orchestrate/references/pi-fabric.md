# Pi Fabric adapter

Use this reference only when Pi Fabric provides the agent runtime. Treat installed tool schemas and Fabric's `docs/agents.md` as the API source of truth.

## Approved groundwork policy

[`../agents/profile.yaml`](../agents/profile.yaml) is the authoritative deliberate policy for approved model keys and bounded `scout`, `builder`, and `reviewer` defaults. Follow [first-use onboarding](onboarding.md) before dispatch.

For every delegated groundwork call, choose an available approved profile key and pass it explicitly as `model`. This includes `agents.run()`, `agents.spawn()`, and every `agent()` / `workflow.agent()` call used by `parallel()` or `pipeline()`. Apply the selected role's `thinking`, `tools`, `extensions`, and `recursive` defaults. The profile is prompt-level policy mapped to existing APIs, not native Fabric enforcement.

An omitted model can inherit Main's expensive model. Setting `agents.model` is only an additional default, never a substitute for an explicit dispatch model. If no approved model is available for an item, return control to the user before dispatch; use another model only with explicit user approval.

## Dispatch and topology

- Use `agents.run()` for blocking work. Use `agents.spawn()` when Main has useful work before reconciliation, then `agents.wait({ id })` when the result is needed. Detached runs can notify Main on completion when configured.
- `agent()` / `workflow.agent()` is a bounded single-worker helper; `parallel()` fans out thunks; `pipeline()` sequences stages per item with cross-item concurrency. `workflow.configure()`, phases, items, events, and logs provide orchestration visibility, not worker policy. Every worker call still requires the explicit model and role defaults above.
- Each `fabric_exec` `agentBudget` must cover its number of launches. `tokenBudget` meters `agent()`, `workflow.agent()`, council, and rlm after observed usage; it is neither a hard concurrent ceiling nor a limit on bare `agents.run()` / `agents.spawn()` batches.
- Fabric maps role effort through `thinking`: `low`, `medium`, and `high`. Omit `timeoutMs` unless the work needs longer than the configured agent timeout.

See [topology.md](topology.md) for arrangement mappings and user-only advanced-skill recommendations.

## Capability, ownership, and lifecycle

- The profile's scout and reviewer allowlist is read-only. Builders require disjoint writable paths; for concurrent writers, prefer `worktree: true`, explicitly integrate, then call `agents.cleanup({ id })`.
- Keep ordinary leaves non-recursive. Use `recursive: true` or `rlm.query()` only for an explicitly assigned recursive partition with a Pi runner.
- Keep user approvals in Main. Recursive children inherit agent-coordination approval, not network, execution, or write approvals.
- Normalize terminal results as `completed`, `failed`, `stopped`, or `timed_out`; distinguish a launch error from a launched worker's terminal result.
- Prefer `agents.steer()` when redirection preserves useful context and `agents.stop()` when replacement is cheaper. Track background work by handle, status, and logs; use lifecycle subscriptions rather than model-authored polling for cross-participant events.
- Verify the combined workspace after integration. Worker completion proves an item, not the overall outcome.
