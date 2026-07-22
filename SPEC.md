# Agent Swarm Service Specification

Status: Draft v1 (language-agnostic)

Purpose: Define a service that uses pi coding-agent processes to complete one root goal with an agent swarm.

## Normative Language

The key words `MUST`, `MUST NOT`, `REQUIRED`, `SHOULD`, `SHOULD NOT`, `RECOMMENDED`, `MAY`, and
`OPTIONAL` in this document are to be interpreted as described in RFC 2119.

`Implementation-defined` means the behavior is part of the implementation contract, but this
specification does not prescribe one universal policy. Implementations MUST document the selected
behavior.

The words `Observed`, `Inferred`, `Proposed`, and `Open` identify the evidence class:

- `Observed`: The named source states or demonstrates the behavior.
- `Inferred`: The behavior follows from source facts, but the source does not state it directly.
- `Proposed`: This specification supplies a substitute design or a new requirement.
- `Open`: The controlled sources do not give enough information for one normative design.

## 1. Problem Statement

The service converts one root goal into a recursive task tree. Planner agents decompose goals and
own shared design decisions. Worker agents execute bounded leaf tasks.

The service uses a pi coding-agent extension as each agent runtime. A separate orchestrator owns
processes, scheduling, claims, budgets, shared records, change integration, and recovery. Pi does
not supply those swarm services.

The service solves these operational problems:

- It limits planner and worker context to the correct level of detail.
- It prevents two agents from owning the same task or design decision.
- It detects file collisions before a change enters the shared baseline.
- It controls token use, cost, quality, and review work.
- It restores useful work after a process or service restart.

Important boundary:

- Cursor reports experimental swarm behavior. Cursor does not publish a complete implementation contract.
- Symphony supplies the document design. It does not supply agent-swarm or pi behavior.
- Pi supplies one coding-agent runtime and extension API. It does not supply a swarm scheduler or a VCS.
- Sections marked `Proposed` are necessary substitute designs. They do not claim unpublished Cursor behavior.

## 2. Goals and Non-Goals

### 2.1 Goals

- Build a recursive task tree from one root goal.
- Give planners authority for decomposition and shared design decisions.
- Give workers one bounded leaf task at a time.
- Use configurable planner, worker, merge, reconciler, and reviewer models.
- Enforce token budgets, cost budgets, quality gates, and completion rules.
- Integrate atomic changes without lost updates or silent overwrites.
- Use pi extension and RPC interfaces only as the controlled pi sources permit.
- Keep a durable audit trail for every claim, transition, change, review, and budget debit.
- Recover from process exit, service restart, API failure, and incomplete integration.

### 2.2 Non-Goals

- Reproduce Cursor's unpublished swarm, VCS, prompts, or infrastructure.
- Treat one pi session as a parallel-agent runtime.
- Treat pi as a VCS, merge queue, task database, secret store, or process supervisor.
- Require one model provider or one repository technology.
- Guarantee deterministic model output.
- Permit agents to change orchestration records through normal file tools.

## 3. System Overview

### 3.1 Main Components

1. `Workflow Loader`
   - Reads the repository-owned swarm workflow.
   - Returns validated configuration and prompt templates.

2. `Orchestrator`
   - Owns the root goal, task tree, scheduler, claims, budgets, and transitions.
   - Is the only authority that can commit orchestration state.

3. `Planner Runtime`
   - Runs one pi process for one planner node.
   - Produces child tasks and shared design decisions.
   - Does not implement leaf work.

4. `Worker Runtime`
   - Runs one pi process for one worker leaf.
   - Produces one bounded change and its evidence.
   - Does not decompose the root goal.

5. `Change Store` (`Proposed`)
   - Stores immutable atomic changes and baseline revisions.
   - Detects path, symbol, and design-decision collisions.
   - Supplies integration compare-and-swap operations.

6. `Neutral Merge Runtime` (`Proposed`)
   - Resolves one detected change conflict.
   - Has no ownership in either conflicting task subtree.

7. `Design Reconciler` (`Proposed`)
   - Resolves conflicting shared design records.
   - Revalidates dependent tasks and changes.

8. `Review Stack`
   - Runs independent review lenses.
   - Applies configured quality gates before completion.

9. `Field Guide Store`
   - Stores agent-authored shared context.
   - Injects its index into each new agent run.

10. `Pi Runtime Adapter`
    - Starts one `pi --mode rpc` process for each concurrent agent run.
    - Loads the swarm extension and exchanges strict JSONL records.

11. `Observability Store`
    - Stores structured events, metrics, errors, and audit records.

### 3.2 Abstraction Levels

1. `Policy Layer`: workflow, prompts, quality gates, tool policy, and Field Guide rules.
2. `Coordination Layer`: task tree, claims, scheduling, budgets, retries, and cancellation.
3. `Integration Layer`: changes, collisions, merges, design records, and baseline revisions.
4. `Execution Layer`: isolated workspace, pi process, extension, tools, and RPC client.
5. `Evidence Layer`: reviews, tests, usage, costs, logs, and source traceability.

### 3.3 Required External Dependencies

- A durable transactional state store.
- A workspace-isolation mechanism.
- A change store or VCS adapter with atomic compare-and-swap.
- A pi coding-agent executable compatible with the pinned pi API profile.
- Configured model providers and credentials.
- A secret provider that does not put raw secrets in prompts or session files.

### 3.4 Authority Rules

| Record | Sole write authority | Read authority |
|---|---|---|
| Root goal and task tree | Orchestrator | All agents through bounded views |
| Shared design decision | Owning planner; reconciler after conflict | Dependent planners and workers |
| Task claim | Orchestrator | All agents |
| Worker change | Owning worker until submission; integrator after submission | Reviewers and dependent agents |
| Baseline revision | Change Store integrator | All components |
| Field Guide | Field Guide curator transaction | All agents |
| Budget ledger | Orchestrator | Agents and operators |
| Review verdict | Assigned reviewer; gate evaluator for aggregate state | Orchestrator and owner |

An agent runtime MUST NOT write these records through repository file tools.

## 4. Core Domain Model

### 4.1 Common Field Contract

Every durable record MUST include these fields.

| Field | Type | Default | Validation | Authority | Invariant | Error and recovery |
|---|---|---|---|---|---|---|
| `id` | non-empty string | none | Unique in its record type | Creating authority | Immutable | Reject duplicate; generate a new ID before commit |
| `version` | integer | `1` | `>=1` | State store | Increases by one per commit | Return `version_conflict`; reload and retry |
| `created_at` | RFC 3339 timestamp | current UTC time | Valid instant | State store | Immutable | Reject invalid record |
| `updated_at` | RFC 3339 timestamp | `created_at` | Not before `created_at` | State store | Equals commit time | Replace with commit time |
| `evidence_class` | enum | `Proposed` | `Observed`, `Inferred`, `Proposed`, or `Open` | Record owner | Matches Appendix A | Reject unknown value |

### 4.2 Entity Field Contracts

The common fields from Section 4.1 apply to each entity.

| Entity field | Type | Default | Validation | Authority | Invariant | Error and recovery |
|---|---|---|---|---|---|---|
| `RootGoal.text` | non-empty string | none | Maximum is implementation-defined | Operator | Immutable after start | Reject blank input; create a new goal for material change |
| `RootGoal.acceptance_criteria` | list of non-empty strings | `[]` | No duplicate normalized item | Operator | Completion checks every item | Return `invalid_goal`; request corrected criteria |
| `RootGoal.state` | `GoalState` | `Draft` | Section 7 transitions only | Orchestrator | One terminal state | Reject invalid transition; reload state |
| `RootGoal.token_budget` | non-negative integer or null | null | Provider-counted tokens | Operator | Debits never decrease | Pause dispatch on exhaustion |
| `RootGoal.cost_budget` | non-negative decimal or null | null | One configured currency | Operator | Debits never decrease | Pause dispatch on exhaustion |
| `TaskNode.parent_id` | string or null | null for root only | Parent exists | Planner proposes; orchestrator commits | No cycle | Return `invalid_tree`; reject child set |
| `TaskNode.kind` | enum | none | `planner`, `worker`, `merge`, `reconciler`, or `reviewer` | Planner proposes standard tasks; orchestrator creates service tasks | Only planner has children | Reject invalid role or decomposition |
| `TaskNode.title` | non-empty string | none | Unique among siblings after normalization | Planner proposes; orchestrator commits | Stable after claim | Create replacement task for material change |
| `TaskNode.scope` | bounded text and path set | none | Non-empty for worker | Planner proposes; orchestrator commits | Worker writes only in scope unless Section 9.8 applies | Block tool call; return `scope_violation` |
| `TaskNode.acceptance_criteria` | list of strings | `[]` | Worker requires at least one item | Planner proposes; orchestrator commits | Gates refer to these items | Return `invalid_leaf`; planner revises task |
| `TaskNode.design_decision_ids` | set of IDs | `[]` | Decisions exist | Planner proposes; orchestrator commits | Worker cannot replace them | Return `unknown_decision`; reload plan |
| `TaskNode.token_budget` | non-negative integer or null | null | Does not exceed parent remainder | Planner proposes; orchestrator commits | Child reservations do not exceed parent | Return `invalid_budget_allocation`; replan subtree |
| `TaskNode.cost_budget` | non-negative decimal or null | null | Uses goal currency; within parent remainder | Planner proposes; orchestrator commits | Child reservations do not exceed parent | Return `invalid_budget_allocation`; replan subtree |
| `TaskNode.state` | `TaskState` | `Pending` | Section 7 transitions only | Orchestrator | Parent completes after all children | Reject invalid transition |
| `TaskNode.priority` | integer | `100` | `>=0` | Planner proposes; orchestrator commits | Lower value runs first | Normalize invalid value to error |
| `TaskNode.retry_count` | integer | `0` | `>=0` | Orchestrator | Increases after retryable failure | Reject stale update |
| `PlannerNode.model_selector` | string | config planner model | Model exists and has auth | Orchestrator | Fixed for one run | Return `model_unavailable`; use allowed fallback |
| `PlannerNode.decision_namespace` | set of strings | derived from scope | No overlap with active peer owner | Orchestrator | One owner per design question | Queue node for reconciliation |
| `WorkerLeaf.model_selector` | string | config worker model | Model exists and has auth | Orchestrator | Fixed for one run | Return `model_unavailable`; use allowed fallback |
| `WorkerLeaf.output_limit` | integer | `change_store.max_operations` | `>0` and not above config cap | Orchestrator | One atomic change within limit | Split leaf before dispatch |
| `Claim.task_id` | string | none | Task is claimable | Orchestrator | At most one live claim per task | Return `claim_conflict`; do not start process |
| `Claim.owner_run_id` | string | none | Run exists | Orchestrator | Matches active run | Revoke orphan claim during reconciliation |
| `Claim.lease_expires_at` | timestamp | now plus lease | Future instant | Orchestrator | Renewal uses compare-and-swap | Expire claim; cancel stale run |
| `AgentRun.role` | enum | none | `planner`, `worker`, `merge`, `reconciler`, or `reviewer` | Orchestrator | Role does not change | Start a new run for a new role |
| `AgentRun.pid` | integer or null | null | Positive when running | Process supervisor | One process per run | Mark run `Lost`; retry after checks |
| `AgentRun.session_id` | string or null | null | Equals pi RPC session ID | Pi Runtime Adapter | One pi session per run | Query `get_state`; replace lost run |
| `AgentRun.workspace_id` | string or null | null | Existing isolated workspace when set | Workspace Manager | Set before process start | Stop process; quarantine workspace |
| `AgentRun.state` | `RunState` | `Starting` | Section 7 transitions only | Orchestrator | Terminal state does not change | Reject stale event |
| `AgentRun.last_event_at` | timestamp | start time | Monotonic per run | Pi Runtime Adapter | Used for stall detection | Keep prior value on malformed event |
| `RetryEntry.attempt` | positive integer | `1` | `>=1` | Orchestrator | Increases per failed attempt | Reject stale timer |
| `RetryEntry.due_at` | timestamp | computed | Not before now at creation | Orchestrator | One live retry per task | Replace older timer atomically |
| `RetryEntry.error_code` | string | none | Registered error code | Orchestrator | Matches failed attempt | Use `unknown_error` for unclassified error |
| `DesignDecision.namespace` | non-empty string | none | Unique active owner | Owning planner | Identifies one shared question | Reconcile duplicate namespaces |
| `DesignDecision.owner_planner_id` | planner task ID | none | Planner exists and owns namespace | Orchestrator | One owner for active version | Freeze duplicate ownership and reconcile |
| `DesignDecision.statement` | non-empty string | none | Passes decision gate | Owning planner or reconciler | Immutable per version | Create superseding version |
| `DesignDecision.dependency_ids` | set of task IDs | `[]` | Tasks exist | Orchestrator | Dependents use current version | Requeue stale dependents |
| `ChangeSet.base_revision` | string | none | Revision exists | Change adapter | Immutable | Rebase through merge agent |
| `ChangeSet.operations` | ordered list | none | Non-empty and serializable | Change adapter for worker or merge run | Atomic application | Reject whole change on one invalid operation |
| `ChangeSet.touched_paths` | set of canonical paths | derived | Paths stay in workspace root | Change Store | Equals operation targets | Return `path_mismatch`; regenerate manifest |
| `ChangeSet.design_refs` | set of decision versions | `[]` | Current at submission | Change owner | No stale shared design | Return `stale_design`; requeue task |
| `ChangeSet.supersedes` | set of change IDs | `[]` | Each change exists and shares the conflict | Neutral merge agent | Originals stay immutable | Return `invalid_supersession`; reject merge change |
| `ChangeSet.superseding_id` | change ID or null | null | Target change exists | Change Store | Set only with `Superseded` state | Return `invalid_supersession`; keep conflict quarantined |
| `ChangeSet.producer` | task, run, model, and config IDs | none | All identities match | Orchestrator | Immutable provenance | Reject submission and quarantine workspace |
| `ChangeSet.evidence` | tests, reviews, tokens, and cost object | `{}` | Required gate evidence exists | Change owner and gate evaluator | Binds to content digest | Reject incomplete manifest |
| `ChangeSet.content_digest` | digest string | none | Approved algorithm and valid bytes | Change Store | Identifies exact operations | Return `digest_mismatch`; rebuild manifest |
| `ChangeSet.state` | `ChangeState` | `Draft` | Section 7 transitions only | Change Store | Integrates at most once | Reject duplicate integration |
| `CollisionRecord.change_ids` | set of change IDs | none | At least two existing changes | Change Store | Immutable parties | Reject collision and run detection again |
| `CollisionRecord.overlap_kinds` | set of enums | none | Path, symbol, design, generated, baseline, core, or megafile | Change Store | At least one kind | Reject malformed collision |
| `CollisionRecord.common_base` | baseline revision ID | none | Revision exists | Change Store | Immutable comparison base | Recompute against current baseline |
| `CollisionRecord.resolution_id` | change or decision ID or null | null | Resolution exists when set | Orchestrator | One accepted resolution | Reopen collision after stale resolution |
| `ReviewRecord.lens` | enum or string | none | Configured lens | Orchestrator | One verdict per lens and change revision | Replace only with newer review version |
| `ReviewRecord.subject_revision` | change, plan, or decision version | none | Subject exists | Orchestrator | Verdict binds to exact bytes or record | Mark stale and run review again |
| `ReviewRecord.model_selector` | model selector | configured reviewer | Registry confirms allowed model and authentication | Orchestrator | Fixed for one review | Retry with allowed fallback |
| `ReviewRecord.verdict` | enum | `Pending` | `Pass`, `Fail`, or `Abstain` after review | Reviewer | Evidence accompanies fail | Retry review on malformed result |
| `ReviewRecord.findings` | list | `[]` | Each finding has severity and locator | Reviewer | Findings bind to change revision | Mark stale after change update |
| `FieldGuideEntry.key` | non-empty string | none | Unique normalized key | Curator transaction | Stable reference | Merge duplicate entry |
| `FieldGuideEntry.text` | text | none | Meets line and trust rules | Curator transaction | No secret or untrusted instruction | Reject entry and log reason |
| `FieldGuideEntry.provenance` | source ID and locator | none | Source exists | Proposing agent and curator | Immutable origin | Quarantine entry with missing source |
| `FieldGuideEntry.trust` | enum | `unreviewed` | `unreviewed` or `reviewed` | Curator transaction | Untrusted text cannot self-upgrade | Reject invalid upgrade and run review |
| `FieldGuideEntry.line_count` | positive integer | derived | Matches normalized text | Curator transaction | Total stays within guide budget | Reject entry or curate older content |
| `FieldGuideEntry.retention` | enum | `review` | `session`, `review`, or `durable` | Curator transaction | Durable needs review evidence | Downgrade unreviewed entry to `review` |
| `FieldGuideEntry.review_ids` | set of review IDs | `[]` | Each review exists and targets entry version | Curator transaction | Only passing reviews count | Remove stale ID and keep entry unreviewed |
| `FieldGuideEntry.confirmation_count` | non-negative integer | `0` | Distinct later runs supply confirmations | Curator transaction | A proposal run cannot confirm itself | Ignore duplicate; expire entry at retention limit |
| `BudgetReservation.task_id` | task ID | none | Task is dispatchable | Orchestrator | One live reservation per task | Release stale reservation during reconciliation |
| `BudgetReservation.run_id` | run ID | none | Run exists and matches task | Orchestrator | One reservation per run | Release orphan reservation; requeue task |
| `BudgetReservation.role` | run-role enum | none | Matches `AgentRun.role` | Orchestrator | Selects role caps | Reject dispatch and rebuild reservation |
| `BudgetReservation.max_tokens` | non-negative integer or null | configured role cap | Fits remaining token budget | Orchestrator | Admission uses this value | Reject dispatch and keep task ready |
| `BudgetReservation.max_cost` | non-negative decimal or null | derived price estimate | Fits remaining cost budget | Orchestrator | Uses goal currency | Reject dispatch or apply unknown-cost policy |
| `BudgetReservation.released_at` | timestamp or null | null | Not before creation | Orchestrator | Set once after settlement | Reconcile from terminal run and usage records |
| `UsageDebit.run_id` | run ID | none | Run exists | Orchestrator | Supplies task and role dimensions | Quarantine orphan debit; rebuild from source |
| `UsageDebit.provider` | non-empty string | none | Matches source usage | Orchestrator | Binds provider dimension | Quarantine mismatch; query protected source |
| `UsageDebit.model` | model selector | none | Matches source usage and run policy | Orchestrator | Binds model dimension | Quarantine mismatch; fail run by policy |
| `UsageDebit.source_id` | pi entry or event ID | none | Source exists and contains usage | Orchestrator | Pair with run ID is unique | Ignore duplicate; quarantine conflicting value |
| `UsageDebit.tokens` | token category object | zeros | Non-negative provider values | Orchestrator | Immutable for source ID | Rebuild from protected source record |
| `UsageDebit.reported_cost` | decimal or null | null | Non-negative and currency-known | Orchestrator | Preferred over estimate | Use versioned estimate or stop by policy |
| `UsageDebit.estimated_cost` | decimal or null | null | Non-negative and currency-known | Orchestrator | Used only without reported cost | Recalculate only with recorded price revision |
| `UsageDebit.price_revision` | string or null | null | Required for estimated cost | Orchestrator | Immutable estimate provenance | Mark cost unknown and stop by policy |
| `BudgetLedger.goal_id` | goal ID | none | Goal exists | Orchestrator | One ledger per goal and currency | Return `duplicate_ledger`; reconcile by immutable events |
| `BudgetLedger.currency` | uppercase three-letter code | config currency | Matches `[A-Z]{3}` | Orchestrator | Immutable for one goal | Return `currency_mismatch`; reject debit |
| `BudgetLedger.reservation_ids` | set of reservation IDs | `[]` | Records exist and match goal | Orchestrator | Unreleased sums stay within caps | Rebuild from reservation events before dispatch |
| `BudgetLedger.tokens` | non-negative integer | `0` | From pi usage | Orchestrator | Monotonic | Rebuild from immutable usage events |
| `BudgetLedger.cost` | non-negative decimal | `0` | Configured currency | Orchestrator | Monotonic | Rebuild from immutable usage events |
| `BudgetLedger.price_revisions` | set of strings | `[]` | Each estimated debit names one revision | Orchestrator | Equals revisions in usage debits | Rebuild from immutable usage debits |
| `BudgetLedger.quality_score` | decimal or null | null | Metric-defined range | Gate evaluator | Bound to baseline revision | Mark stale after integration |

### 4.3 State Enums

- `GoalState`: `Draft`, `Active`, `Canceling`, `Completed`, `Failed`, `Canceled`, `BudgetStopped`.
- `TaskState`: `Pending`, `Ready`, `Claimed`, `Running`, `RetryWait`, `Reviewing`, `Integrating`, `Completed`, `Failed`, `Canceled`, `Blocked`.
- `RunState`: `Starting`, `Running`, `Settling`, `Stopping`, `Succeeded`, `Failed`, `Aborted`, `Lost`.
- `ChangeState`: `Draft`, `Submitted`, `Conflicted`, `Reviewing`, `Accepted`, `Integrated`, `Rejected`, `Superseded`.

### 4.4 Stable Identifiers and Normalization

- IDs MUST use collision-resistant values with at least 128 bits of entropy.
- Paths MUST use absolute canonical form for comparison.
- Task titles MUST use Unicode normalization, trim, and lowercase for duplicate checks.
- Model selectors MUST use `provider/model-id` form.
- Baseline revisions MUST be immutable content or transaction identifiers.
- Currency MUST use one configured uppercase three-letter code for one goal.

## 5. Workflow Specification (Repository Contract)

This section is `Proposed`. The controlled sources do not define a portable swarm workflow file.

### 5.1 File Discovery

The default workflow path is `.pi/swarm.yaml` under the trusted project root. A host option MAY
select another path. The selected path MUST stay inside the trusted project root.

The service MUST reject a missing, unreadable, untrusted, or non-map workflow file. It MUST keep
the last known good workflow after an invalid reload.

### 5.2 File Format

The workflow is one YAML map. Unknown keys MUST cause `unknown_config_field`. This rule prevents
silent policy errors.

The workflow has these top-level maps:

- `goal`
- `models`
- `orchestrator`
- `budgets`
- `quality`
- `workspace`
- `change_store`
- `field_guide`
- `pi`
- `security`
- `observability`

### 5.3 Prompt Template Contract

Prompt templates MUST use strict variable and filter checks. The runtime MUST fail one run when a
template uses an unknown variable. It MUST NOT use an unvalidated fallback prompt.

Required templates:

- `planner_system`
- `planner_task`
- `worker_system`
- `worker_task`
- `merge_system`
- `reconciler_system`
- `reviewer_system`
- `continuation`

### 5.4 Dynamic Reload

The service MUST detect workflow changes. Valid changes apply to future claims and future pi
processes. A reload MUST NOT change the policy snapshot of an active run.

Budget reductions apply immediately to new dispatch. Security restrictions apply immediately to
new tool calls when the extension can enforce them. Otherwise, the service MUST cancel the run.

## 6. Configuration Specification

### 6.1 Resolution Pipeline

1. Resolve the trusted project root.
2. Select the workflow path.
3. Parse YAML as one map.
4. Reject unknown fields.
5. Apply defaults.
6. Resolve approved secret references through the host secret provider.
7. Validate cross-field invariants.
8. Create an immutable configuration snapshot.

### 6.2 Configuration Field Contracts

All durations use integer milliseconds. A list or map uses an empty default only when its row does
not state another default.

| Field | Type and default | Validation | Authority | Invariant | Error and recovery |
|---|---|---|---|---|---|
| `goal.text` | string; required | Non-empty | Operator | Equals root goal text | `invalid_goal`; reject start |
| `goal.acceptance_criteria` | list; `[]` | Unique non-empty items | Operator | Checked before completion | `invalid_goal`; reject start |
| `models.planner` | selector; required | Available and authenticated | Operator | Used by planner runs | `model_unavailable`; use listed fallback |
| `models.worker` | selector; required | Available and authenticated | Operator | Used by worker runs | Same as planner |
| `models.merge` | selector; planner model | Available | Operator | Neutral merge role only | Use planner model fallback |
| `models.reconciler` | selector; planner model | Available | Operator | Reconciler role only | Use planner model fallback |
| `models.reviewers` | map; `{default: models.worker}` | Lens keys or `default`; valid selectors | Operator | Every required lens resolves to one selector | `invalid_review_stack`; block completion |
| `models.fallbacks` | map; `{}` | No selector cycle | Operator | Order is stable | `fallback_cycle`; reject config |
| `models.thinking_level` | map; `{default: off}` | Role or model keys; supported value | Operator | Effective value enters run snapshot | `thinking_unsupported`; use `off` or fail by policy |
| `orchestrator.max_planners` | integer; `2` | `>=1` | Operator | Counts live planner runs | Pause planner dispatch at limit |
| `orchestrator.max_workers` | integer; `8` | `>=1` | Operator | Counts live worker runs | Pause worker dispatch at limit |
| `orchestrator.max_mergers` | integer; `2` | `>=1` | Operator | Counts live merge runs | Queue merge work at limit |
| `orchestrator.max_reconcilers` | integer; `1` | `>=1` | Operator | Counts live reconciler runs | Queue reconciliation at limit |
| `orchestrator.max_reviewers` | integer; `4` | `>=1` | Operator | Counts live review runs | Queue review |
| `orchestrator.claim_lease_ms` | integer; `60000` | `>=1000` | Operator | Exceeds heartbeat interval | `invalid_lease`; reject config |
| `orchestrator.heartbeat_ms` | integer; `10000` | `>0` and less than lease | Operator | One heartbeat per live run | Mark missed run for reconciliation |
| `orchestrator.stall_ms` | integer; `300000` | `0` disables; else greater than heartbeat | Operator | Uses last pi event time | Cancel and retry stalled run |
| `orchestrator.retry_limit` | integer; `3` | `>=0` | Operator | Per task and failure class | Mark task failed after limit |
| `orchestrator.retry_base_ms` | integer; `10000` | `>0` | Operator | Exponential backoff base | Reject invalid config |
| `orchestrator.retry_cap_ms` | integer; `300000` | At least base | Operator | Caps backoff | Reject invalid config |
| `budgets.goal_tokens` | integer or null; null | `>=0` | Operator | Hard dispatch limit | Set `BudgetStopped` at limit |
| `budgets.goal_cost` | decimal or null; null | `>=0` | Operator | Hard dispatch limit | Set `BudgetStopped` at limit |
| `budgets.currency` | string; `USD` | Matches `[A-Z]{3}` | Operator | One currency per goal | Reject mixed cost input |
| `budgets.planner_tokens` | integer or null; null | `>0` when set | Operator | Per planner run | Abort run at observed limit boundary |
| `budgets.worker_tokens` | integer or null; null | `>0` when set | Operator | Per worker run | Abort run at observed limit boundary |
| `budgets.merge_tokens` | integer or null; planner token limit | `>0` when set | Operator | Per merge run | Abort run at observed limit boundary |
| `budgets.reconciler_tokens` | integer or null; planner token limit | `>0` when set | Operator | Per reconciler run | Abort run at observed limit boundary |
| `budgets.reviewer_tokens` | integer or null; worker token limit | `>0` when set | Operator | Per reviewer run | Abort run at observed limit boundary |
| `budgets.role_cost` | role-to-decimal map; `{}` | Values are `>0`; keys are roles | Operator | Missing role has no role cost cap | Reject invalid cap; apply goal cap |
| `budgets.review_fraction` | decimal; `0.20` | From `0` through `1` | Operator | Reserve from goal budget | Block new worker when reserve is at risk |
| `quality.required_lenses` | list; required | Lens exists | Operator | All MUST pass | Keep change in `Reviewing` |
| `quality.test_commands` | list; `[]` | Command policy permits each command | Operator | Run in isolated workspace | Reject change on required test failure |
| `quality.minimum_score` | decimal or null; null | Metric-defined range | Operator | Applies to goal completion | Block completion below score |
| `quality.max_open_findings` | integer; `0` | `>=0` | Operator | Counts blocking findings | Block integration |
| `workspace.root` | absolute path; required | Existing parent; not filesystem root | Operator | Contains all run workspaces | `unsafe_workspace_root`; reject start |
| `workspace.isolation` | enum; `copy` | `copy`, `worktree`, `container`, or adapter value | Operator | Separate writable view per run | Fail closed on unsupported mode |
| `workspace.cleanup` | enum; `on_success` | `never`, `on_success`, or `always` | Operator | Evidence persists before removal | Quarantine on cleanup failure |
| `workspace.max_file_lines` | integer; `2000` | `>0` | Operator | Megafile threshold | Apply Section 9.7 gate |
| `workspace.core_paths` | path patterns; `[]` | Canonical project-relative patterns | Operator | Controls Section 9.8 | Reject invalid pattern |
| `change_store.adapter` | string; required | Adapter supports atomic compare-and-swap | Operator | One adapter per goal | `unsupported_change_store`; reject start |
| `change_store.max_operations` | integer; `100` | `>0` | Operator | Atomic change size limit | Split leaf or reject change |
| `change_store.collision_modes` | list; `[path, symbol, design]` | Known modes | Operator | All configured checks run | Reject config on unknown mode |
| `field_guide.path` | path; `.pi/field-guide` | Inside trusted project | Operator | Agent-owned data location | Disable guide on unsafe path |
| `field_guide.index` | filename; `index.md` | One relative file name | Operator | Injected at each run start | Create an empty trusted index after `missing_field_guide` |
| `field_guide.line_budget` | integer; `400` | `>0` | Operator | Counts index lines | Reject entry that exceeds limit |
| `field_guide.retention_reviews` | integer; `2` | `>=1` | Operator | Durable entry review count | Expire unconfirmed entry |
| `pi.command` | string; `pi` | Non-empty executable | Operator | Launches RPC process | `pi_not_found`; fail run |
| `pi.mode` | literal; `rpc` | MUST equal `rpc` | Specification | Strict JSONL control | Reject other mode for backend |
| `pi.extension_path` | path; required | Trusted, readable, pinned | Operator | Loaded for every run | `extension_load_failed`; fail run |
| `pi.control_channel` | literal; `inherited_fd` | MUST equal `inherited_fd` | Specification | Separate from pi RPC streams | Reject another transport in this profile |
| `pi.control_fd_env` | string; `SWARM_CONTROL_FD` | Safe environment name | Specification | Holds only the inherited descriptor number | Reject override or child inheritance |
| `pi.control_max_bytes` | integer; `1048576` | From `4096` through `16777216` | Operator | Counts UTF-8 bytes before LF | Reject oversized record and fail run |
| `pi.control_response_ms` | integer; `10000` | `>0` | Operator | One retry uses the same request ID | Fail run after repeated timeout |
| `pi.session_dir` | path; under workspace metadata | Writable; not agent-writable | Orchestrator | One directory per run | Create safe directory or fail run |
| `pi.no_session` | boolean; `false` | Boolean | Operator | False when policy requires restart recovery | Reject true with session recovery policy |
| `pi.expose_session_environment` | boolean; `false` | Boolean | Operator | Controls bash access to pi session metadata | Replace or disable unsafe bash tool before prompt |
| `pi.auto_retry` | boolean; `false` | Boolean | Operator | Orchestrator owns task retries | Send `set_auto_retry` after start |
| `pi.auto_compaction` | boolean; `true` | Boolean | Operator | Compaction events enter usage ledger | Send `set_auto_compaction` after start |
| `pi.rpc_response_ms` | integer; `10000` | `>0` | Operator | Applies to correlated response | Kill process after protocol recovery fails |
| `pi.ui_dialog_ms` | integer; `30000` | `>0` | Operator | Applies to approved RPC dialogs | Cancel unanswered dialog and fail closed |
| `pi.shutdown_grace_ms` | integer; `10000` | `>=0` | Operator | Graceful stop before force stop | Force stop after grace |
| `security.project_trust` | enum; `require` | `require` or `preapproved` | Operator | Project-local extension needs trust | Do not dispatch untrusted project |
| `security.allowed_tools` | list; `[read]` | Registered non-swarm pi tool names | Operator | Extension adds only required role-specific swarm tools | Block unknown or extra tool |
| `security.denied_paths` | path patterns; derived protected set | Canonical paths | Operator | Contains session, state, secret, and baseline paths | Block and emit security finding |
| `security.secret_refs` | map; `{}` | Host secret references only | Operator | Raw value never enters prompt | `missing_secret`; fail affected run |
| `security.network_policy` | adapter object; `{mode: deny}` | Adapter validates | Operator | Applies before process start | Fail closed when not enforceable |
| `observability.event_sink` | string; required | Writable sink | Operator | Immutable event append | Buffer locally; stop dispatch if buffer fills |
| `observability.metrics_interval_ms` | integer; `5000` | `>0` | Operator | Snapshot interval | Keep last good snapshot |
| `observability.redaction` | rule list; required | At least secret rules | Operator | Runs before output | Drop event on redaction failure |

### 6.3 Cross-Field Validation

- The claim lease MUST exceed two heartbeat intervals.
- The retry cap MUST be at least the retry base.
- A durable recovery policy MUST use persisted pi sessions.
- An enabled bash tool MUST use a controlled replacement when `pi.expose_session_environment` is false.
- The supervisor MUST reserve the control descriptor before each pi process starts.
- Every required review lens MUST have a model selector.
- The Field Guide and all workspaces MUST stay inside approved roots.
- The review budget reserve MUST remain available before new worker dispatch.

## 7. Orchestration State Machine

The orchestrator is the only component that commits state transitions. An event handler MUST use
the record version as a compare-and-swap guard.

### 7.0 Common Transition Contract

Each row in Sections 7.1 through 7.4 has this field contract:

| Property | Contract |
|---|---|
| Type | An ordered pair of enum states, `From -> To` |
| Default | None; a record stays in its current state without a valid trigger |
| Validation | The current state, trigger, guard, and record version MUST match one table row |
| Authority | The authority in the row is the only transition writer |
| Invariant | The guard and invariant in the row MUST pass in one transaction |
| Error | An invalid request returns `invalid_transition` and does not change state |
| Recovery | Reload the current record, reconcile external state, and retry only a valid row |

### 7.1 Goal Transitions

| From | To | Trigger | Authority | Guard and invariant | Error and recovery |
|---|---|---|---|---|---|
| `Draft` | `Active` | Validated start request | Orchestrator | Config, sources, stores, and root goal are valid | Return `start_preflight_failed`; remain `Draft` |
| `Active` | `Canceling` | Operator cancel or fatal policy event | Orchestrator | Stop new claims first | Retry cancellation until all runs stop |
| `Active` | `Completed` | Completion evaluator passes | Orchestrator | All required tasks, reviews, tests, and criteria pass | Return `completion_gate_failed`; remain `Active` |
| `Active` | `Failed` | Non-recoverable failure | Orchestrator | Failure evidence is durable | Operator can create a new goal from snapshot |
| `Active` | `BudgetStopped` | Observed debits exhaust the hard budget | Orchestrator | No new run can start | Operator can increase budget through a versioned change |
| `Canceling` | `Canceled` | All runs and retries stop | Orchestrator | No live claim remains | Reconcile orphan process or claim |
| `BudgetStopped` | `Active` | Valid budget increase | Orchestrator | New budget exceeds debits and reserve | Reject insufficient increase |
| `BudgetStopped` | `Canceling` | Operator cancels stopped goal | Orchestrator | No new claims can start | Continue normal cancellation |

### 7.2 Task Transitions

| From | To | Trigger | Authority | Guard and invariant | Error and recovery |
|---|---|---|---|---|---|
| `Pending` | `Ready` | Parent plan commits | Orchestrator | Dependencies exist and no cycle exists | Reject child set |
| `Ready` | `Claimed` | Scheduler grants claim | Orchestrator | Capacity, budget, and dependency gates pass | Keep task `Ready` |
| `Claimed` | `Running` | Pi process reaches `agent_start` | Orchestrator | Claim lease is live | Cancel late process |
| `Claimed` | `RetryWait` | Process fails before `agent_start` | Orchestrator | Run is terminal; no live claim remains; retry limit permits work | Create one stored retry entry |
| `Running` | `Reviewing` | Owner submits valid plan, change, or decision | Orchestrator | Submission binds to current task version | Return `stale_submission`; retry owner task |
| `Running` | `Completed` | Reviewer record commits and run settles | Orchestrator | Verdict binds to assigned subject and lens | Retry malformed or missing review |
| `Reviewing` | `Integrating` | Required reviews pass | Orchestrator | No blocking finding remains | Return task to `Ready` for correction |
| `Reviewing` | `Ready` | Review requests a correctable revision | Orchestrator | Prior run is terminal and no live claim remains | Create a new run and subject version |
| `Integrating` | `Completed` | Role completion condition passes | Orchestrator | Own or superseding change integrated, planner descendants completed, or decision committed | Reconcile incomplete role output |
| `Running` | `RetryWait` | Retryable run failure settles | Orchestrator | Run is terminal; no live claim remains; retry limit permits work | Create one stored retry entry |
| `RetryWait` | `Ready` | Stored retry time arrives | Orchestrator | Dependencies, capacity prechecks, and task version remain valid | Keep retry entry until every guard passes |
| Any nonterminal | `Canceled` | Goal cancellation or invalidated plan | Orchestrator | Stop run before claim release | Reconcile until no process owns task |
| Any nonterminal | `Blocked` | Unresolved dependency or Open Question | Orchestrator | Blocking record states conformance effect | Recheck after blocker changes |
| `Blocked` | `Ready` | Blocking record closes | Orchestrator | Dependencies, budget, and task version remain valid | Keep blocked when one guard fails |
| Any nonterminal | `Failed` | Retry limit or fatal failure | Orchestrator | Durable evidence exists | Parent planner can create replacement task |

For a planner, `Reviewing` validates the plan and `Integrating` commits the task-tree transaction.
The planner task stays `Integrating` while descendants are active. Its decision records retain
planner authority. The orchestrator creates a reconciler task only after a recorded conflict.

### 7.3 Run Transitions

| From | To | Trigger | Authority | Guard and invariant | Error and recovery |
|---|---|---|---|---|---|
| `Starting` | `Running` | Pi `agent_start` RPC event | Orchestrator | Process and claim identities match | Stop unknown process |
| `Running` | `Settling` | Pi `agent_end` event | Orchestrator | `agent_end` can still have `willRetry=true` | Wait for `agent_settled` |
| `Settling` | `Running` | Pi starts another low-level run | Orchestrator | Retry or queued continuation is valid and the claim is live | Stop work with a stale claim |
| `Settling` | `Succeeded` | Pi `agent_settled` and valid submission | Orchestrator | No queued continuation remains | Fail run if submission is absent |
| `Starting` | `Stopping` | Cancel, budget, or policy signal | Orchestrator | Supervisor knows process identity, or startup aborts | Continue shutdown sequence |
| `Running` | `Stopping` | Cancel, stall, budget, or policy signal | Orchestrator | Send RPC `abort` first | Continue shutdown sequence |
| `Settling` | `Stopping` | Cancel, stall, budget, or policy signal | Orchestrator | Send RPC `abort` first | Continue shutdown sequence |
| `Stopping` | `Aborted` | Pi settles or exits after abort | Orchestrator | Process is not live | Revoke claim after evidence flush |
| Any nonterminal | `Failed` | Protocol, extension, model, or tool failure | Orchestrator | Error has stable code | Apply failure policy |
| Any nonterminal | `Lost` | Process identity is absent after restart | Orchestrator | No process can still mutate shared state | Quarantine workspace; retry task |

### 7.4 Change Transitions

| From | To | Trigger | Authority | Guard and invariant | Error and recovery |
|---|---|---|---|---|---|
| `Draft` | `Submitted` | Worker finalizes manifest | Change Store | Operations and evidence are complete | Reject whole submission |
| `Submitted` | `Conflicted` | Collision detector finds overlap | Change Store | Conflict record names all parties | Assign neutral merge agent |
| `Submitted` | `Reviewing` | No collision exists | Change Store | Base and design versions are current | Recheck before review |
| `Reviewing` | `Accepted` | Review stack passes | Gate evaluator | Required lenses pass | Return to owner after fail |
| `Accepted` | `Integrated` | Compare-and-swap succeeds | Change Store | One atomic baseline update | Return `baseline_conflict`; detect again |
| `Accepted` | `Submitted` | Baseline compare-and-swap fails | Change Store | Baseline did not change through this attempt | Invalidate reviews and detect collisions again |
| Any nonterminal | `Rejected` | Fatal policy or review failure | Change Store | Rejection evidence exists | Parent planner can replace leaf |
| Any nonterminal | `Superseded` | New accepted change replaces it | Change Store | Superseding ID exists | Keep immutable old record |

### 7.5 Claim and Lease Rules

- A task MUST have at most one live claim.
- The scheduler MUST create the claim before it starts a pi process.
- The process supervisor MUST send run and claim versions through its heartbeat channel.
- The orchestrator MUST renew the lease with compare-and-swap after process health checks.
- A worker MUST NOT renew a claim through pi session data or repository files.
- The orchestrator MUST cancel a run that reports an expired or different claim version.
- Claim release MUST occur after process stop and evidence flush.

### 7.6 Retry Rules

Failure backoff uses this formula:

```text
delay_ms = min(retry_base_ms * 2^(attempt - 1), retry_cap_ms)
```

The orchestrator MUST add bounded random jitter. It MUST store the selected due time. A restart
MUST keep that due time.

A retryable run failure moves its task to `RetryWait`. The due retry moves the task to `Ready`
only after the prior run stops and releases its claim.

These failures are retryable by default:

- provider rate limit or transient provider error;
- pi process exit before submission;
- RPC response timeout after process health checks;
- workspace creation failure caused by a transient resource limit;
- baseline compare-and-swap conflict after neutral merge assignment.

Security violations, invalid configuration, and invalid source evidence are not retryable by
default.

### 7.7 Cancellation Rules

1. Stop new claims for the affected subtree.
2. Move each active run to `Stopping` and send RPC `abort`.
3. Wait for `agent_settled` or process exit until `pi.shutdown_grace_ms` expires.
4. Send `shutdown_command`, record its response, and close RPC stdin.
5. Force-stop the process after the grace period.
6. Flush usage, events, tool results, and session cursor.
7. Revoke claims and quarantine incomplete changes.
8. Mark affected tasks `Canceled` after no process can mutate them.

## 8. Polling, Scheduling, and Reconciliation

### 8.1 Scheduler Tick

Each tick MUST run these operations in order:

1. Reconcile live processes, claims, sessions, budgets, and baseline revisions.
2. Apply cancellation and stall rules.
3. Validate the current workflow snapshot for new dispatch.
4. Promote tasks whose dependencies now pass.
5. Complete planner tasks whose required descendants completed.
6. Reserve review capacity and budget.
7. Dispatch planners, merge agents, reconcilers, reviewers, and workers in priority order.
8. Emit one durable scheduler snapshot.

### 8.2 Dispatch Priority

The scheduler MUST use this stable priority order:

1. cancellation and security work;
2. design reconciliation;
3. neutral merge work;
4. required review work;
5. root and subtree planning;
6. worker leaves.

Within one class, lower `TaskNode.priority` runs first. Older ready time breaks a tie. Task ID is
the final tie-breaker.

### 8.3 Planner Rules

- A planner MUST decompose only its assigned node.
- A planner MUST keep shared design decisions at the nearest common planner ancestor.
- A planner MUST NOT delegate the same design question to two child subtrees.
- A planner MUST create worker leaves with bounded scope and testable acceptance criteria.
- A planner MUST NOT submit implementation changes.
- A planner MAY create another planner node when the child problem needs decomposition.
- The orchestrator completes a planner only after its required descendants complete.

### 8.4 Worker Rules

- A worker MUST execute only one leaf task.
- A worker MUST NOT create child tasks.
- A worker MUST read all referenced design decision versions before mutation.
- A worker MUST submit one atomic change and evidence manifest.
- A worker MUST stop when its task becomes stale, canceled, or out of budget.

### 8.5 Budget Admission

Before dispatch, the scheduler MUST reserve the configured maximum run tokens and cost. It MAY use
a lower estimate when the implementation documents the estimate method.

A null goal or task budget gives no cap for that dimension. Goal, task, and non-null role caps
still apply. The five `budgets.*_tokens` fields supply role token caps. `budgets.role_cost` supplies
optional role cost caps.

A reservation uses its explicit role cost cap first. Otherwise, it uses the priced role token cap.
Only the configured unknown-cost policy can permit a null cost reservation.

Admission MUST fail when any condition is true:

- the reservation exceeds the goal hard limit;
- the reservation exceeds the task subtree limit;
- the reservation exceeds the role limit;
- non-review work uses the review reserve;
- required provider pricing is unknown and policy does not permit unknown cost.

Unused reservation returns after run settlement. Observed usage always debits the ledger.

### 8.6 Model-Economics Metrics

The service MUST calculate these metrics per role, model, task subtree, and goal:

- input, output, cache-read, cache-write, and total tokens;
- estimated and reported cost;
- accepted changes per million tokens;
- quality-gate passes per unit cost;
- review findings per reviewed change;
- rework tokens divided by accepted-work tokens;
- planner tokens divided by total tokens;
- worker tokens divided by total tokens;
- wall time, queue time, active time, and settlement time;
- collision, merge, and retry rates.

The service MUST NOT treat a high commit count as a quality metric. Cursor reports that high
commit activity can be churn.

### 8.7 Reconciliation

Reconciliation MUST compare these authorities:

- durable task and claim state;
- live OS process identity;
- pi RPC `get_state` response;
- pi RPC `get_entries` durable cursor;
- workspace and submitted-change manifests;
- Change Store baseline revision;
- budget and usage ledgers.

When authorities disagree, the orchestrator MUST stop new mutation for the affected task. It MUST
record the disagreement before recovery.

## 9. Workspace Management and Safety

### 9.1 Workspace Layout

Each run gets one writable workspace under `workspace.root`. The workspace name MUST contain the
task ID and run ID. The service MUST use a safe canonical path check before process start.

Shared orchestration state, session metadata, secrets, and baseline metadata MUST NOT be writable
through the agent workspace.

### 9.2 Isolation

Concurrent agents MUST use separate writable workspaces or equivalent filesystem isolation. Two
agents MUST NOT write the same working file through a shared checkout.

The workspace adapter MUST document:

- creation and cleanup operations;
- baseline materialization;
- symlink handling;
- filesystem boundary checks;
- quota behavior;
- crash recovery;
- support for case-sensitive and case-insensitive filesystems.

### 9.3 File-Mutation Queue

Pi runs sibling tool calls in parallel by default. A custom file-mutation tool MUST call
`withFileMutationQueue(absolutePath, callback)`.

The tool MUST resolve the real target path before queue selection. The queued callback MUST cover
the full read-modify-write interval. Queueing only the final write is not conforming.

This queue protects one pi process from local lost updates. It does not replace workspace
isolation, the Change Store, or cross-process collision detection.

### 9.4 Atomic Change Contract

One worker change MUST include:

- immutable base revision;
- ordered operations;
- canonical touched paths;
- affected symbols when the language adapter can supply them;
- referenced design decision versions;
- test and quality evidence;
- worker task, run, model, token, and cost identities;
- a content digest.

The Change Store MUST accept or reject all operations as one transaction. Partial integration is
not conforming.

Each `ChangeOperation` MUST use one row from this table.

| `kind` | Required fields | Validation and effect |
|---|---|---|
| `write` | `path`, `expected_before_digest`, `content_ref`, `content_digest`, `file_mode` | Create or replace one regular file from an immutable verified blob |
| `delete` | `path`, `expected_before_digest` | Remove the matching regular file |
| `move` | `from_path`, `to_path`, `expected_before_digest` | Move the matching regular file without content change |

Paths MUST use canonical project-relative form. `expected_before_digest` MAY be null only for a new
`write`. `file_mode` MAY be null or one approved regular-file mode. A change MUST target each path
at most once; a `move` targets both paths.

### 9.5 Collision Detection

Before review and before integration, the Change Store MUST check:

- path overlap;
- symbol overlap when supported;
- incompatible design decision versions;
- generated-file and source-file ownership;
- baseline changes after worker read;
- core-path exceptions;
- megafile gates.

A collision record MUST identify the changes, common base, overlap type, and current baseline.

### 9.6 Neutral Merge Agents

A neutral merge agent MUST have no task ownership in either conflicting subtree. It receives both
changes, their bases, design references, tests, and conflict record.

The merge agent MUST produce a new change. It MUST NOT edit either submitted change. The new change
MUST pass the complete review stack.

After integration, the Change Store MUST mark both original changes `Superseded`. The new change ID
MUST be their superseding ID.

The orchestrator completes an original producer task only when the merged change meets its
acceptance criteria. The final review evidence MUST name each completed producer task.

If the conflict represents a design disagreement, the merge agent MUST stop. A design reconciler
MUST resolve the decision first.

### 9.7 Megafile Control

A file is a megafile when it exceeds `workspace.max_file_lines` or an adapter-specific complexity
limit. A worker MAY flag a file before the limit.

`swarm_flag_megafile` records the canonical path, evidence, task, and run. The orchestrator MUST
run the configured validator before it confirms or rejects the flag.

After a confirmed flag, the Change Store MUST block new ordinary changes to that file. The
orchestrator MUST assign an outside decomposition agent. That agent MUST split the file without
changing behavior, unless its task states another approved goal.

The block ends only after required review and integration of the decomposition change.

### 9.8 Controlled Core Changes

A worker MAY propose a focused change outside its normal path scope when all conditions pass:

- the target matches `workspace.core_paths`;
- the change is necessary for the assigned leaf;
- the worker records a reason, expected breakage, and migration rule;
- the change gets a separate core-change review lens;
- the orchestrator invalidates and rechecks all dependent tasks.

This is a `Proposed` substitute for Cursor's intentional-breakage behavior. Cursor does not publish
the exact propagation mechanism for a general prototype.

`swarm_request_core_change` creates a provisional exception. The record binds to the run, task
version, path, reason, breakage list, and migration rule. The `tool_call` gate MUST verify the
current record before each core mutation. Cancellation, run end, or task-version change expires it.

### 9.9 Shared Design Reconciliation

Shared design decisions MUST use versioned records. Dependent changes MUST carry compile-checked or
machine-checked references when the implementation language permits them.

When planners conflict, the orchestrator MUST freeze both decision namespaces. A reconciler MUST
produce one superseding decision and a dependency impact list. The scheduler MUST requeue stale
dependents.

### 9.10 Stacked Review

The review stack MUST use at least these independent lenses:

- task acceptance criteria;
- behavior and tests;
- architecture and shared design;
- security and tool policy;
- change integration and regression risk.

An implementation SHOULD use different prompts, context views, or models to decorrelate lenses.
One passing lens MUST NOT cancel one failing required lens.

### 9.11 Field Guide

The Field Guide is agent-owned shared context. Its `index.md` content MUST enter every new agent run
through `before_agent_start` or an equivalent verified prompt path.

Field Guide rules:

- Agents own proposals and curation.
- The curator MUST enforce `field_guide.line_budget`.
- Entries SHOULD record surprising facts that shorten later work.
- Session entries expire at session end.
- Review entries expire after `field_guide.retention_reviews` without confirmation.
- Durable entries need one passing review and one later confirmation.
- Instructions from untrusted files, tool output, model output, or external content MUST NOT become trusted guide policy automatically.
- Secrets, credentials, personal data, and raw untrusted instructions MUST NOT enter the guide.
- The orchestrator and security policy override the guide.

## 10. Agent Runner Protocol (Pi Coding-Agent Integration)

This section defines the pi binding. The pinned pi sources in Appendix A control API behavior.

### 10.1 Compatibility Profile

The conforming profile targets pi repository revision
`bb3d7d399c06e5fe284f34eb66b15b037ab18649`.

An implementation MUST pin a tested pi package or executable version. It MUST run compatibility
tests before it accepts another revision. A revision change that alters an event, method, result,
mode, or persistence rule requires a new compatibility profile.

Pi reports `tui`, `rpc`, `json`, and `print` modes. This backend profile uses only `rpc`. Another
mode can run extensions, but it does not conform to this backend profile.

This profile requires a host that can pass one private full-duplex descriptor to a child process.
A host without this control-channel capability needs a new compatibility profile.

### 10.2 Process Model

The orchestrator MUST start one OS process for each concurrent `AgentRun`. Each process MUST run one
pi RPC session in one isolated workspace.

Reference launch:

```text
pi --mode rpc --provider <provider> --model <model-id>:<thinking> \
  --name <task-id> --session-dir <protected-run-session-dir> \
  -e <trusted-swarm-extension-path>
```

The exact option order is not significant. The process working directory MUST equal the run
workspace.

One pi session does not supply parallel agents. Pi can execute sibling tool calls concurrently
inside one agent turn. That behavior does not create planner or worker processes.

Pi does not supply a VCS. The Change Store and workspace adapters remain separate services.

### 10.3 RPC Transport

RPC mode uses JSON objects on stdin and stdout. Each record uses strict JSONL framing. LF (`\n`) is
the only record delimiter. A client MAY strip one trailing CR from CRLF input.

The client MUST NOT use a line reader that splits on Unicode line separators. The client MUST keep
stderr separate from RPC stdout.

The extension MUST NOT write swarm protocol records to pi RPC stdout. The supervisor MUST create a
private full-duplex socket pair for each run. It MUST pass one endpoint as `SWARM_CONTROL_FD`.
Tool child processes MUST NOT inherit that endpoint or its environment name.

Each command SHOULD have a unique `id`. A response has `type:"response"`, the command name,
`success`, and the same `id`. Events do not have request IDs.

RPC dialogs use `extension_ui_request` and matching `extension_ui_response` records. Only an
approved project-trust dialog MAY block this backend. The extension MUST set its timeout to
`pi.ui_dialog_ms`. The client MUST cancel an unexpected dialog and record a policy error.

The approved request MUST contain `type:"extension_ui_request"`, a unique `id`,
`method:"confirm"`, `title`, `message`, and integer `timeout`. The client MUST return one of these
records:

- `{"type":"extension_ui_response","id":<same-id>,"confirmed":<boolean>}`;
- `{"type":"extension_ui_response","id":<same-id>,"cancelled":true}`.

The client MAY ignore a fire-and-forget UI request after it records the request. Pi resolves a
timed-out dialog with its documented default value. The swarm MUST treat that result as denial.

### 10.4 RPC Command Contract

| Command | Required input | Success data used by swarm | Error or cancellation rule |
|---|---|---|---|
| `prompt` | `message`; optional `images`, `streamingBehavior` | Acceptance only; completion uses events | During streaming, missing `streamingBehavior` is an error |
| `steer` | `message`; optional `images` | Queued steering | Extension commands are not allowed |
| `follow_up` | `message`; optional `images` | Queued follow-up | Extension commands are not allowed |
| `abort` | none | Abort accepted | Wait for settlement or exit |
| `get_state` | none | Model, thinking, streaming, session file, session ID, name, pending count | Treat missing identity as protocol failure |
| `set_model` | `provider`, `modelId` | Full selected `Model` | `success:false` blocks run start |
| `set_thinking_level` | `level` | Acceptance | Level MUST be available for model |
| `get_available_models` | none | Full model list | Fail model admission on error |
| `get_available_thinking_levels` | none | Supported levels | Use `off` only if policy permits |
| `set_auto_compaction` | `enabled` | Acceptance | Fail run setup on error |
| `set_auto_retry` | `enabled` | Acceptance | Swarm default is false |
| `abort_retry` | none | Retry abort accepted | Use during cancellation |
| `get_session_stats` | none | Tokens, cost, context usage | Keep last good values on transient error |
| `get_entries` | optional `since` entry ID | Entries and `leafId` | Unknown cursor returns `success:false`; request full entries |
| `get_last_assistant_text` | none | Final text or null | Null is valid before assistant output |
| `set_session_name` | `name` | Acceptance | Log nonfatal name error |
| `switch_session` | `sessionPath` | `cancelled` | Use only during recovery; respect cancellation |
| `new_session` | optional `parentSession` | `cancelled` | Not used to create concurrent agents |

`prompt success:true` means that pi accepted, queued, or handled the prompt. Later failures appear in
events and messages. The orchestrator MUST NOT treat command acceptance as task success.

### 10.5 RPC Event Contract

| Event | Swarm action | Important data and rule |
|---|---|---|
| `agent_start` | Move run to `Running` | Agent processing started |
| `agent_end` | Move run to `Settling` | `willRetry` can be true; do not complete yet |
| `agent_settled` | Evaluate submission and terminal run state | No retry, compaction retry, or queued continuation remains |
| `turn_start` | Record turn start | One assistant response begins |
| `turn_end` | Record turn result | Contains assistant message and tool results |
| `message_start` | Start message audit record | Contains `AgentMessage` |
| `message_update` | Refresh last-event time | Contains partial message and delta event |
| `message_end` | Finalize message and usage | Persist assistant usage |
| `tool_execution_start` | Open tool audit record | Contains call ID, name, and arguments |
| `tool_execution_update` | Refresh progress | Partial result contains accumulated output, not a delta |
| `tool_execution_end` | Finalize tool record | Contains result and `isError` |
| `queue_update` | Record pending messages | Contains steering and follow-up queues |
| `compaction_start` | Record compaction | Reason is `manual`, `threshold`, or `overflow` |
| `compaction_end` | Debit usage and record retry state | `aborted`, `willRetry`, result, and error can appear |
| `auto_retry_start` | Record provider retry | Contains attempt, limit, delay, and error |
| `auto_retry_end` | Record result | Final failure has `finalError` |
| `summarization_retry_scheduled` | Record summary retry delay | Contains attempt, limit, delay, and error |
| `summarization_retry_attempt_start` | Record retry source | Contains `compaction` or `branchSummary`; compaction includes reason |
| `summarization_retry_finished` | Record retry completion | Do not complete the run before later settlement |
| `extension_error` | Apply extension error policy | Contains extension path, event, and error |

### 10.6 Extension Factory and Events

The swarm extension MUST export a default factory with this verified form:

```text
(pi: ExtensionAPI) => void | Promise<void>
```

Pi awaits an asynchronous factory before `session_start`. The factory MUST NOT start long-lived
resources. The extension MUST start session resources from `session_start` and close them from an
idempotent `session_shutdown` handler.

The extension MUST use these exact event contracts:

| Pi event | Verified input and allowed result | Required swarm use |
|---|---|---|
| `project_trust` | Input `cwd`; result `{trusted:"yes"|"no"|"undecided", remember?}` | Apply the configured project trust decision |
| `session_start` | Input `reason`, optional `previousSessionFile`; no result | Restore extension state and open bounded resources |
| `resources_discover` | Input `cwd`, `reason`; result optional skill, prompt, and theme paths | Add only policy-approved trusted paths |
| `before_agent_start` | Input prompt, images, system prompt, and prompt options; result optional message and system prompt | Inject task, design, guide, and run identity |
| `context` | Input copied messages; result `{messages}` | Remove stale transient context without changing durable records |
| `tool_call` | Input `toolName`, `toolCallId`, mutable `input`; result optional `{block:true, reason?}` | Enforce tool, path, scope, secret, and core policy |
| `tool_result` | Input tool identity, content, details, error, and usage; result can patch those result fields | Redact, normalize, and account for output and usage |
| `model_select` | Input `model`, optional `previousModel`, and source; return ignored | Verify the selected model against the run snapshot |
| `thinking_level_select` | Input `level` and `previousLevel`; return ignored | Record the effective thinking level |
| `session_shutdown` | Input `reason`, optional `targetSessionFile`; no result | Close resources and persist final extension state |

The extension MAY observe message, turn, provider, and tool-execution events. The RPC client still
owns durable orchestration events.

### 10.7 Verified Extension Methods and Context

| API | Contract in this specification |
|---|---|
| `pi.on(event, handler)` | Subscribe to the verified event name and return only its documented result |
| `pi.registerTool(definition)` | Register bounded swarm tools; schema uses TypeBox |
| `pi.appendEntry(customType, data?)` | Persist extension data outside LLM context |
| `pi.sendMessage(message, options?)` | Add a custom context message with `steer`, `followUp`, or `nextTurn` delivery |
| `pi.sendUserMessage(content, options?)` | Send a user message; specify delivery while streaming |
| `pi.exec(command, args, options?)` | Execute an approved host command; record stdout, stderr, code, and killed state |
| `pi.getActiveTools()` | Read active tool names |
| `pi.getAllTools()` | Read registered tool metadata and source information |
| `pi.setActiveTools(names)` | Enforce the run tool set; pi ignores unknown names, which MUST fail swarm validation |
| `pi.setModel(model)` | Select model; false means no API key is available |
| `pi.getThinkingLevel()` | Read effective thinking level |
| `pi.setThinkingLevel(level)` | Set level; pi clamps to model capability |
| `ctx.cwd` | MUST equal the run workspace |
| `ctx.mode` | MUST equal `rpc` for the conforming backend |
| `ctx.hasUI` | Is true in RPC mode; extension dialogs need an orchestrator response policy |
| `ctx.isProjectTrusted()` | MUST be true before project-local policy loads |
| `ctx.sessionManager` | Read-only session access in extension event contexts |
| `ctx.modelRegistry`, `ctx.model`, and `ctx.thinkingLevel` | Resolve provider, model, authentication, and effective thinking metadata |
| `ctx.signal` | Current abort signal during an active turn; can be undefined while idle |
| `ctx.isIdle()` | True only when pi has no active or automatic work |
| `ctx.abort()` | Abort current agent processing |
| `ctx.hasPendingMessages()` | Check queued work before settlement |
| `ctx.shutdown()` | Request graceful pi shutdown; deferred until idle in RPC mode |
| `ctx.getContextUsage()` | Read current estimated context usage |
| `ctx.compact(options)` | Start nonblocking compaction with completion and error callbacks |
| `ctx.getSystemPrompt()` | Read pi's current prompt string, subject to documented later changes |

Command-only session methods include `ctx.waitForIdle()`, `ctx.newSession()`, `ctx.fork()`,
`ctx.navigateTree()`, `ctx.switchSession()`, and `ctx.reload()`. Event handlers and tools MUST NOT
call these methods.

After session replacement, captured old `pi`, context, and `SessionManager` objects are stale. A
callback MUST use only the new replacement-session context.

Verified `SessionManager` functions used for persistence and recovery are:

- Static creation: `SessionManager.create(cwd, sessionDir?)`, `SessionManager.open(path, sessionDir?)`,
  `SessionManager.continueRecent(cwd, sessionDir?)`, `SessionManager.inMemory(cwd?)`, and
  `SessionManager.forkFrom(sourcePath, targetCwd, sessionDir?)`.
- Static listing: `SessionManager.list(cwd, sessionDir?, onProgress?)` and
  `SessionManager.listAll(onProgress?)`.
- Session management: `newSession(options?)`, `setSessionFile(path)`, and
  `createBranchedSession(leafId)`.
- Append operations: `appendMessage`, `appendThinkingLevelChange`, `appendModelChange`,
  `appendCompaction`, `appendCustomEntry`, `appendSessionInfo`, `appendCustomMessageEntry`, and
  `appendLabelChange`.
- Navigation: `getLeafId`, `getLeafEntry`, `getEntry`, `getBranch`, `getTree`, `getChildren`,
  `getLabel`, `branch`, `resetLeaf`, and `branchWithSummary`.
- Context and identity: `buildContextEntries`, `buildSessionContext`, `getEntries`, `getHeader`,
  `getSessionName`, `getCwd`, `getSessionDir`, `getSessionId`, `getSessionFile`, and `isPersisted`.

The extension context exposes `sessionManager` as read-only. Direct append operations are for the
programmatic SessionManager API. Extensions SHOULD use `pi.appendEntry()` for extension state.

### 10.8 Custom Tool Data Contract

A custom tool uses this verified execution form:

```text
execute(toolCallId, params, signal, onUpdate, ctx) -> ToolResult
```

`ToolResult` contains `content` and MAY contain `details`, `usage`, and `terminate`. Returning a
value does not set `isError`. The tool MUST throw an error to report failure. Pi catches the error,
sets `isError:true`, reports it to the model, and continues.

If every finalized result in one tool batch returns `terminate:true`, pi can skip the automatic
follow-up model call.

Tool output MUST use the pi limits of 50 KB or 2,000 lines, whichever occurs first. A truncated
result MUST state that truncation occurred and identify the protected full-output location.

Pi gives its built-in bash tool `PI_SESSION_ID`, `PI_SESSION_FILE`, `PI_PROVIDER`, `PI_MODEL`, and
`PI_REASONING_LEVEL`. A custom `createBashTool()` does this by default.

The default swarm policy MUST exclude the built-in bash tool. If policy enables bash, the
extension MUST register a controlled replacement. The replacement MUST set
`exposeSessionEnvironment:false` unless `pi.expose_session_environment` is true. An enabled
environment MUST have process-level controls that prevent session-file mutation and data leaks.

### 10.9 Required Swarm Extension Tools

The extension MUST register these tool names. It MUST derive run, claim, task, and workspace
identities from protected extension state. A model-supplied identity MUST NOT replace that state.

Each tool MUST call the orchestrator through the inherited control channel. The channel uses strict
JSONL with these records:

```text
request = {
  id: unique string,
  tool: registered swarm tool name,
  run_id: protected run ID,
  expected_task_version: positive integer | null,
  payload: object
}

response = {
  id: matching request ID,
  success: boolean,
  details: object | null,
  error: Section 14.2 error object | null
}

shutdown_command = {
  id: unique host-command ID,
  command: "shutdown",
  run_id: protected run ID,
  reason: cancel | stall | budget | policy | service_stop
}

shutdown_response = {
  id: matching host-command ID,
  accepted: boolean,
  error: Section 14.2 error object | null
}
```

The inherited endpoint is the run capability. The orchestrator MUST reject a mismatched run ID,
closed claim, oversized record, record after cancellation, or reused ID with different content.
It MUST return the cached terminal response for an exact request retry.

The extension MUST wait `pi.control_response_ms` for a response. It MAY repeat the exact request
once with the same ID. A second timeout causes `control_protocol_error` and fails the run.

The envelope task version MUST equal its payload value. `swarm_read_task` uses null and returns the
current bounded view. A mismatch causes `control_protocol_error`.

The extension MUST start its control-channel listener from `session_start`. A valid
`shutdown_command` calls `ctx.shutdown()` once and returns `shutdown_response`. The
`session_shutdown` handler MUST close the listener.

| Tool name | Authorized role | Input contract | Successful `details` |
|---|---|---|---|
| `swarm_read_task` | All roles | `{}` | `{task:TaskView}` |
| `swarm_submit_plan` | Planner | `PlanInput` | `{record_id, version, state:"staged"}` |
| `swarm_submit_change` | Worker or merge | `ChangeInput` | `{record_id, version, state:"Submitted"}` |
| `swarm_submit_decision` | Reconciler | `DecisionInput` | `{record_id, version, state:"staged"}` |
| `swarm_submit_review` | Reviewer | `ReviewInput` | `{record_id, version, state:"recorded"}` |
| `swarm_propose_guide_entry` | Planner or worker | `GuideInput` | `{record_id, version, state:"unreviewed"}` |
| `swarm_confirm_guide_entry` | Planner or worker | `GuideConfirmInput` | `{record_id, version, confirmation_count}` |
| `swarm_request_core_change` | Worker | `CoreChangeInput` | `{record_id, version, state:"provisional"}` |
| `swarm_flag_megafile` | Worker | `MegafileInput` | `{record_id, version, state:"pending_validation"}` |

The tool data types are:

Each field without an explicit default requires a value. The extension MUST reject unknown fields
with `invalid_tool_input`. It MUST apply defaults before cross-field validation.

```text
TaskView = {
  task_id: string,
  task_version: positive integer,
  role: planner | worker | merge | reconciler | reviewer,
  scope: {description: string, paths: list<string>},
  acceptance_criteria: list<string>,
  design_refs: list<{decision_id: string, version: positive integer}>,
  baseline_revision: string,
  remaining_tokens: non-negative integer | null,
  remaining_cost: non-negative decimal | null,
  allowed_tools: list<string>
}

PlanInput = {
  expected_task_version: positive integer,
  children: non-empty list<{
    client_key: string,
    kind: planner | worker,
    title: string,
    scope: {description: string, paths: list<string>},
    acceptance_criteria: list<string>,
    priority: non-negative integer = 100,
    model_selector: string | null = null,
    decision_namespaces: list<string> = []
  }>,
  dependencies: list<{before: client_key, after: client_key}> = [],
  decisions: list<{
    namespace: string,
    statement: string,
    dependent_client_keys: list<client_key> = []
  }> = [],
  budget_reservations: list<{
    client_key: string,
    max_tokens: non-negative integer | null,
    max_cost: non-negative decimal | null
  }> = [],
  risks: list<string> = []
}

ChangeInput = {
  expected_task_version: positive integer,
  expected_base_revision: string,
  design_refs: list<{decision_id: string, version: positive integer}> = [],
  summary: non-empty string,
  test_evidence: list<{name: string, status: pass | fail, evidence_ref: string}> = []
}

DecisionInput = {
  conflict_id: string,
  expected_decision_versions: non-empty list<{decision_id: string, version: positive integer}>,
  namespace: string,
  statement: non-empty string,
  affected_task_ids: non-empty list<string>,
  rationale: non-empty string
}

ReviewInput = {
  subject_type: plan | change | decision | field_guide,
  subject_id: string,
  subject_version: positive integer,
  lens: string,
  verdict: Pass | Fail | Abstain,
  findings: list<{
    severity: info | warning | error | critical,
    locator: string,
    message: non-empty string
  }> = []
}

GuideInput = {
  key: non-empty string,
  text: non-empty string,
  provenance: {source_id: string, locator: string}
}

CoreChangeInput = {
  path: canonical project-relative path,
  reason: non-empty string,
  expected_breakage: non-empty list<string>,
  migration_rule: non-empty string
}

MegafileInput = {
  path: canonical project-relative path,
  reason: non-empty string,
  observed_lines: positive integer | null = null,
  complexity_evidence: list<string> = []
}

GuideConfirmInput = {
  entry_id: string,
  entry_version: positive integer,
  evidence_ref: non-empty string
}
```

`swarm_submit_change` MUST calculate operations, paths, symbols, and the content digest from the
isolated workspace and its expected baseline. The model MUST NOT supply this derived manifest.

`swarm_read_task` MUST put a bounded canonical `TaskView` in `content` and `details`. Each other
tool MUST put a short summary in `content`. Every tool MUST put its structured result in `details`.
A mutation tool MUST commit its complete record in one orchestrator transaction.

Each tool MUST check `signal` before validation and before transaction start. An abort before the
transaction throws `[swarm_cancelled] request cancelled`. After transaction start, the store MUST
finish or roll back the transaction before the tool returns.

| Error code | Cause | Recovery |
|---|---|---|
| `invalid_tool_input` | Schema or default check fails | Throw; correct the request |
| `role_violation` | Current role cannot use the tool | Throw; fail the run by policy |
| `stale_task` | Expected task version differs | Throw; cancel run and create an eligible replacement run |
| `claim_conflict` | Protected claim is absent or stale | Throw; cancel the run |
| `scope_violation` | Workspace change exceeds leaf scope | Throw; quarantine workspace and review core exception |
| `invalid_tree` | Plan has a cycle, duplicate owner, or invalid leaf | Throw; planner revises the complete plan |
| `stale_design` | Decision version changed | Throw; cancel or requeue affected work |
| `invalid_change` | Manifest, evidence, or digest check fails | Throw; keep baseline unchanged |
| `review_malformed` | Review lacks a valid verdict or locator | Throw; retry reviewer |
| `field_guide_rejected` | Trust, secret, line, or retention gate fails | Throw; keep guide unchanged |
| `core_change_denied` | Core request lacks scope, reason, breakage, or migration data | Throw; keep normal scope gate |
| `megafile_flag_rejected` | Path or evidence fails flag validation | Throw; keep file state unchanged |
| `store_unavailable` | Required transaction store fails | Throw; fail run and stop new mutation |
| `swarm_cancelled` | Abort arrives before transaction | Throw; follow Section 7.7 |
| `control_protocol_error` | Control record is invalid, mismatched, or too large | Close channel; fail and quarantine run |

The extension MUST use the exact bracketed error code at the start of the safe thrown message. It
MUST also emit the structured Section 14.2 error through the protected orchestrator channel.

### 10.10 Usage and Cost

Assistant messages contain provider, model, token usage, and cost. Tool results MAY contain nested
`usage`. Pi includes nested usage, compaction usage, and branch-summary usage in session totals.

The orchestrator MUST poll `get_session_stats` at settlement and after recovery. It MUST also debit
usage from durable message and tool records. Duplicate usage records MUST use stable entry or event
identities to prevent double debit.

The orchestrator MUST compare cumulative session statistics with the durable-entry sum. It MUST
NOT add cumulative statistics as another debit. A difference MUST stop budget admission until
reconciliation repairs the ledger.

### 10.11 Pi Error Rules

- Failed RPC commands return `success:false` and an `error` string.
- Parse failures use command `parse` and `success:false`.
- Pi logs extension event errors, and the agent usually continues.
- A `tool_call` handler error blocks the tool as a fail-safe action.
- A thrown tool execution error becomes an error tool result, and execution continues.
- `pi.setModel()` returns false when model authentication is not available.
- `pi.sendUserMessage()` throws during streaming when `deliverAs` is absent.
- Project extensions do not load before project trust.

The swarm policy MUST map each pi error to `continue`, `retry`, `fail_run`, `fail_task`, or
`cancel_goal`. The default for an unknown extension or protocol error is `fail_run`.

### 10.12 Persistence and Restart

Pi sessions use append-only JSONL session files. `pi.appendEntry()` stores extension data outside
LLM context. `get_entries` can use a stable entry ID as a durable cursor across client restarts.

The orchestrator MUST protect the session directory from agent file tools. It MUST persist the
last processed entry ID. After restart, it MUST read missing entries before it resumes or replaces
the run.

Session persistence does not restore an OS process. The orchestrator MUST mark the old run `Lost`.
It MAY start a new process and use `switch_session` only after workspace and policy validation.

Control endpoints MUST NOT survive a process. A replacement run gets a new socket pair. The
orchestrator MUST persist completed control-request IDs and their terminal responses.

## 11. Change Store and Shared-Record Integration Contract

This section replaces Symphony's tracker integration with the applicable swarm integration boundary.

### 11.1 Required Operations

The Change Store MUST provide these operations:

```text
read_baseline() -> BaselineRevision
materialize(revision, workspace) -> Result
submit(change_set) -> Result<ChangeId>
detect_collisions(change_id, current_revision) -> list<Collision>
integrate(change_id, expected_revision) -> Result<BaselineRevision>
read_change(change_id) -> ChangeSet
quarantine(change_id, reason) -> Result
```

The shared-record store MUST provide versioned compare-and-swap for tasks, claims, decisions,
reviews, budgets, Field Guide entries, and event cursors.

### 11.2 Operation Rules

- `submit` MUST validate the complete manifest before it stores the change.
- `detect_collisions` MUST be deterministic for one adapter version and input pair.
- `integrate` MUST be atomic and MUST compare `expected_revision`.
- `integrate` MUST set the candidate to `Integrated` and named originals to `Superseded` in the same transaction.
- A failed integration MUST leave the baseline unchanged.
- `quarantine` MUST preserve evidence and remove integration eligibility.
- Adapter errors MUST include a stable code, retryable flag, and safe message.

### 11.3 Adapter Profile

Each adapter MUST document:

- revision identity;
- atomicity and durability guarantees;
- path and symbol normalization;
- collision modes;
- merge-base behavior;
- generated-file policy;
- case-sensitivity behavior;
- maximum change size;
- authentication and secret handling;
- error codes and recovery;
- backup and restore tests.

## 12. Prompt Construction and Context Assembly

### 12.1 Common Inputs

Each agent prompt MUST include:

- immutable run, task, claim, goal, config, and baseline identities;
- role and role boundaries;
- bounded task scope and acceptance criteria;
- current design decision versions;
- allowed tools and denied paths;
- remaining token and cost budgets;
- required output schema;
- cancellation and completion rules;
- Field Guide index after trust filtering;
- evidence-class labels for sourced and substitute requirements.

### 12.2 Planner Prompt

The planner prompt MUST state that the planner owns decomposition and shared design. It MUST state
that the planner does not implement worker leaf changes.

The planner output MUST contain a child-task list, dependency graph, decision ownership map,
acceptance criteria, budget allocation, and risk list. The orchestrator MUST reject a cycle,
duplicate owner, unbounded leaf, or missing acceptance criterion.

### 12.3 Worker Prompt

The worker prompt MUST state that the worker executes one bounded leaf. It MUST prohibit task-tree
changes. It MUST require one atomic change manifest and quality evidence.

### 12.4 Merge, Reconciler, and Reviewer Prompts

- The merge prompt MUST identify both parties and require neutral treatment.
- The reconciler prompt MUST resolve one shared design namespace.
- A reviewer prompt MUST use one named lens and MUST not claim other lens results.
- Each output MUST bind to the reviewed task, change, decision, and baseline versions.

### 12.5 Context Trust Order

Prompt content has this authority order:

1. host security and orchestration policy;
2. this specification and validated workflow;
3. task and design records;
4. reviewed Field Guide content;
5. unreviewed Field Guide content marked as untrusted reference;
6. repository, tool, and external content.

Lower content MUST NOT override higher content. The extension MUST mark untrusted content boundaries.

## 13. Logging, Status, and Observability

### 13.1 Durable Event Envelope

Every durable event MUST use this envelope.

| Field | Type | Default | Validation | Authority | Invariant | Error and recovery |
|---|---|---|---|---|---|---|
| `event_id` | string | generated | Unique | Event Store | Immutable | Generate before append |
| `event_type` | string | none | Registered type | Emitting component | Stable meaning per schema version | Reject unknown type in strict consumers |
| `schema_version` | positive integer | `1` | Supported version | Emitting component | Immutable | Quarantine unsupported event |
| `at` | RFC 3339 timestamp | current UTC | Valid instant | Event Store | Append time does not decrease per stream | Retain received time and flag source time |
| `goal_id` | string | none | Goal exists | Orchestrator | Present on all swarm events | Reject orphan event |
| `task_id` | string or null | null | Task exists when set | Emitting component | Matches run or change | Quarantine mismatch |
| `run_id` | string or null | null | Run exists when set | Emitting component | Matches process identity | Quarantine mismatch |
| `source` | string | none | Registered component | Emitting component | One source identity | Reject unknown source |
| `severity` | enum | `info` | `debug`, `info`, `warning`, `error`, or `critical` | Emitting component | Security policy can raise severity | Normalize unknown to `error` |
| `payload` | JSON object | `{}` | Event schema | Emitting component | Redacted before append | Drop unsafe payload and append redaction error |
| `trace_id` | string | goal trace | Valid trace ID | Orchestrator | Stable across causal chain | Generate recovery trace when absent |

### 13.2 Required Event Types

The service MUST emit events for:

- goal, task, run, claim, retry, and change transitions;
- planner output and plan validation;
- process start, process exit, and pi RPC protocol state;
- tool start, update, end, block, and error;
- collision detection, merge, reconciliation, and integration;
- review assignment, finding, verdict, and gate result;
- budget reservation, debit, release, and exhaustion;
- Field Guide proposal, review, retention, and rejection;
- security decision and secret-policy failure;
- restart, recovery, quarantine, and data repair.

### 13.3 Required Metrics

The service MUST expose:

- ready, claimed, running, reviewing, integrating, blocked, and terminal task counts;
- process counts by role, model, provider, and state;
- claim age, queue time, run time, stall time, and retry delay;
- tokens and cost from Section 8.6;
- review pass, fail, finding, and rework counts;
- collision counts by type and path;
- megafile count, blocked-change count, and split count;
- Field Guide lines, entry age, rejection count, and injection size;
- RPC parse, command, timeout, and extension error counts;
- recovery lag and orphan record counts.

### 13.4 Runtime Snapshot

A runtime snapshot MUST contain the goal state, budget balance, task counts, active runs, and
retries. It MUST also contain the current baseline, pending reviews, open conflicts, and last fatal
error.

Snapshot generation MUST read one consistent state-store transaction. A status surface MUST NOT
become an authority for orchestration.

### 13.5 Logging and Redaction

Logs MUST use stable `key=value` fields for goal, task, run, claim, session, change, and baseline
identities. Logs MUST state the action result and stable error code.

The redaction layer MUST process prompts, tool arguments, tool results, pi events, and errors before
they enter an external sink. The service MUST NOT log secrets, raw provider keys, or full protected
files.

### 13.6 Audit Evidence

Completion MUST produce one immutable audit package with:

- controlled source table and revisions;
- final workflow snapshot;
- final task tree and transition history;
- baseline and integrated change identities;
- design decision history;
- review and test evidence;
- token and cost ledger;
- Open Questions and conformance effects;
- completion checklist result.

## 14. Failure Model and Recovery Strategy

### 14.1 Failure Classes

| Class | Examples | Default effect | Recovery |
|---|---|---|---|
| `workflow` | Missing file, unknown field, invalid cross-field rule | Stop new dispatch | Keep last good config or fix startup config |
| `source` | Missing revision, unsupported factual claim | Block affected requirement | Reclassify as `Proposed` or `Open` |
| `planner` | Cycle, duplicate owner, unbounded leaf | Fail planner run | Retry planner, then replace planner task |
| `worker` | Missing change, scope violation, failed test | Fail worker run or task | Retry or revise leaf |
| `claim` | Expired lease, duplicate claim, stale version | Stop affected run | Reconcile process, then requeue task |
| `workspace` | Unsafe path, quota, cleanup failure | Fail run | Quarantine workspace; create a new isolated workspace |
| `change` | Invalid manifest, baseline conflict, partial adapter error | Block integration | Neutral merge, retry atomic operation, or quarantine |
| `design` | Split brain, planner contention, stale decision | Freeze namespace | Run design reconciler and requeue dependents |
| `review` | Missing verdict, model failure, blocking finding | Block integration | Retry review or revise change |
| `pi_protocol` | Parse error, response timeout, invalid event | Fail run after health check | Abort process; recover session cursor; retry task |
| `pi_extension` | `extension_error`, blocked tool, thrown tool error | Policy-defined | Fail safe for policy gates; retry safe telemetry handlers |
| `provider` | Rate limit, overload, authentication | Retry transient error; fail auth | Backoff or operator credential repair |
| `budget` | Token or cost limit | Stop new work | Increase budget or cancel goal |
| `security` | Secret exposure, trust failure, denied path | Cancel run | Rotate secret if exposed; audit and requeue only after approval |
| `storage` | State-store or event-store unavailable | Stop mutation and dispatch | Restore service and reconcile from durable records |

### 14.2 Error Object

All service errors MUST provide:

```text
{
  code: string,
  message: safe string,
  retryable: boolean,
  scope: goal | task | run | change | service,
  cause_id: string | null,
  recovery: string
}
```

| Field | Type | Default | Validation | Authority | Invariant | Error and recovery |
|---|---|---|---|---|---|---|
| `code` | non-empty string | `unknown_error` | Registered stable code | Emitting component | Policy maps code, not message | Use `unknown_error`; fail run |
| `message` | safe string | code text | Redaction passes | Emitting component | Never controls policy | Replace unsafe text with code |
| `retryable` | boolean | `false` | Matches failure policy | Policy engine | Immutable for error record | Set false and require review |
| `scope` | enum | `run` | `goal`, `task`, `run`, `change`, or `service` | Policy engine | Target exists when applicable | Raise scope to service if target is unknown |
| `cause_id` | string or null | null | Referenced evidence exists | Emitting component | Immutable causal link | Set null and emit evidence warning |
| `recovery` | non-empty safe string | `operator inspection required` | Names an allowed recovery action | Policy engine | Contains no secret or executable input | Use default and stop automatic retry |

The safe message MUST NOT contain a secret. The `code` and `retryable` fields control policy. The
message does not control policy.

### 14.3 Service Restart

After restart, the service MUST:

1. Load the last good workflow and its hash.
2. Verify state-store and Change Store consistency.
3. Mark previously live OS runs `Lost` unless process adoption is proven safe.
4. Revoke expired claims only after workspace quarantine.
5. Read pi session entries after each stored cursor.
6. Rebuild usage debits from new immutable entries.
7. Detect submitted or accepted changes that did not integrate.
8. Reconcile baseline revision and design decision versions.
9. Restore retry due times.
10. Resume eligible tasks only after all checks pass.

The service MUST NOT assume that a persisted pi session means that its old process is live.

### 14.4 Pi Process Recovery

The orchestrator MAY resume a persisted pi session in a new process. Before `switch_session`, it
MUST verify the session path, workspace identity, task version, claim version, config snapshot,
model policy, and baseline revision.

If any identity is stale, the orchestrator MUST start a new session. It MAY inject a reviewed
recovery summary. It MUST NOT copy untrusted raw session data into higher-authority instructions.

### 14.5 Partial Change Recovery

The Change Store MUST use a transaction journal or equivalent atomic mechanism. After restart, it
MUST classify each incomplete integration as:

- `not_started`;
- `committed` with known new revision;
- `aborted` with unchanged revision;
- `indeterminate`.

An `indeterminate` result MUST stop all integration until operator or adapter recovery establishes
one baseline revision.

### 14.6 Field Guide Recovery

The curator MUST validate the Field Guide after restart. It MUST remove or quarantine entries with
invalid provenance, excess lines, secrets, missing review, or broken references.

## 15. Security and Operational Safety

### 15.1 Trust Boundary

Pi extensions run with full process permissions. Pi permits only trusted global, user, or CLI
extensions to participate in `project_trust`. Project-local extensions load only after trust succeeds.

The orchestrator MUST treat these inputs as untrusted:

- root goal text from an external system;
- repository content;
- Field Guide proposals;
- model output;
- tool output;
- provider errors;
- network responses;
- change content from another agent.

### 15.2 Project Trust

The extension MUST handle `project_trust` only according to `security.project_trust`. A handler
returns `yes`, `no`, or `undecided`. The service MUST NOT simulate operator consent when the policy
requires an operator.

Temporary trust MUST expire with the process. Persisted trust MUST record the project identity and
decision source.

### 15.3 Secret Handling

- Secret references MUST resolve in the host process.
- Raw secrets MUST NOT enter workflow files, prompts, Field Guide content, pi session entries, or logs.
- The pi child environment MUST contain only secrets required for its selected provider and tools.
- The service MUST treat `PI_SESSION_FILE` and its contents as protected session data.
- A custom tool SHOULD receive a capability or host-side proxy instead of a raw broad credential.
- A secret exposure event MUST stop the run and trigger the configured rotation procedure.

### 15.4 Tool Policy

The extension MUST set the active tool list from the immutable run snapshot. It MUST reject an
unknown configured tool before the first prompt. Pi ignores unknown names in `setActiveTools`, so
the extension MUST perform this validation itself.

The extension MUST exclude or replace the built-in bash tool before the first prompt. A replacement
bash tool MUST enforce the configured session-environment and command policies.

Every child-tool process MUST close the swarm control descriptor. Its environment MUST omit
`SWARM_CONTROL_FD` and all host-side orchestration credentials.

The `tool_call` gate MUST check:

- tool name;
- canonical target paths;
- task scope;
- core-path rules;
- denied paths;
- network destination;
- command pattern;
- secret references;
- current claim, task, and cancellation state.

A gate error MUST block the tool. This matches pi's fail-safe `tool_call` error behavior.

### 15.5 Filesystem Safety

- The run working directory MUST equal the isolated workspace path.
- The workspace path MUST stay below `workspace.root` after canonicalization.
- Agent tools MUST NOT follow a symlink outside the workspace.
- Session, event, secret, claim, and baseline stores MUST be outside agent-writable paths.
- Cleanup MUST validate the exact run identity before removal.

### 15.6 Network Safety

The process supervisor MUST apply the selected network policy before pi starts. The extension-level
tool gate alone is not sufficient for unrestricted child commands.

The default policy SHOULD deny all network access except selected model-provider endpoints and
approved tool proxies.

### 15.7 Prompt-Injection Safety

The system and task prompts MUST identify lower-authority content as data. A worker MUST NOT treat
repository text, comments, tool output, or Field Guide proposals as policy.

Reviewers MUST check for instructions that try to change tool policy, source class, evidence class,
or completion rules.

### 15.8 Shutdown Safety

`ctx.shutdown()` requests graceful pi shutdown. In RPC mode, pi defers shutdown until its next idle
state. The supervisor MUST still enforce `pi.shutdown_grace_ms` and force-stop after that time.

The extension's `session_shutdown` handler MUST be idempotent. It MUST not start new model or tool
work.

## 16. Reference Algorithms (Language-Agnostic)

### 16.1 Service Startup

```text
function start_service(workflow_path):
  workflow = load_and_validate_workflow(workflow_path)
  if workflow failed:
    fail_startup(workflow.error)

  stores = open_durable_stores()
  if stores failed:
    fail_startup(stores.error)

  assert_change_store_atomicity_profile()
  reconcile_after_restart()

  if no root goal exists:
    goal = create_root_goal(workflow.goal)
  else:
    goal = load_root_goal()

  if goal.state == Draft:
    transition_goal(goal, Active)

  schedule_tick(delay_ms=0)
  run_event_loop()
```

### 16.2 Planner Decomposition

```text
function accept_planner_output(task, output, expected_version):
  require task.kind == planner
  require task.version == expected_version
  require output.children is not empty

  graph = build_child_graph(output.children, output.dependencies)
  require graph has no cycle
  require every worker child has bounded scope
  require every worker child has acceptance criteria
  require no two children own the same design question
  require shared questions belong to task or nearest common planner ancestor
  if task.token_budget is not null:
    require every child has one non-null budget_reservations.max_tokens
    require sum(output.budget_reservations.max_tokens) <= remaining_task_tokens(task)
  if task.cost_budget is not null:
    require every child has one non-null budget_reservations.max_cost
    require sum(output.budget_reservations.max_cost) <= remaining_task_cost(task)

  transaction:
    compare_and_swap(task.version, expected_version)
    stage_design_decisions(output.design_decisions)
    stage_child_tasks(output.children)
    stage_dependencies(output.dependencies)
    stage validated plan submission for task and run

  return staged submission id

function activate_planner_plan(task, submission, reviews):
  require task.kind == planner
  require task.state == Reviewing
  require all required plan reviews pass

  transaction:
    compare_and_swap(task.version, submission.task_version)
    require no active design namespace conflicts with submission
    commit staged decisions, children, and dependencies
    transition task from Reviewing to Integrating
    promote eligible child tasks from Pending to Ready

  return committed plan version
```

### 16.3 Scheduler Tick

```text
function scheduler_tick():
  reconcile_live_state()
  apply_cancellations_and_stall_rules()

  config = load_last_good_config()
  if validate_for_dispatch(config) failed:
    emit dispatch_paused
    schedule_next_tick()
    return

  promote_ready_tasks()
  complete_eligible_planner_tasks_deepest_first()
  reserve_review_capacity()

  for task in stable_priority_order(eligible_tasks()):
    if capacity_for(task.role) == 0:
      continue
    if budget_admission(task) failed:
      continue
    claim = try_claim(task)
    if claim failed:
      continue
    start_agent_run(task, claim, config.snapshot)

  write_scheduler_snapshot()
  schedule_next_tick()
```

### 16.4 Atomic Claim

```text
function try_claim(task):
  transaction:
    current = read_task_for_update(task.id)
    require current.state == Ready
    require no live claim exists for current.id
    require dependencies_pass(current)
    require budget_reservation_exists(current)

    run = new AgentRun(
      id=new_run_id(),
      role=role_for(current),
      state=Starting,
      workspace_id=null,
      pid=null,
      session_id=null
    )
    insert run

    claim = new Claim(
      task_id=current.id,
      owner_run_id=run.id,
      lease_expires_at=now() + claim_lease_ms
    )
    insert claim
    transition current from Ready to Claimed
  return claim
```

### 16.5 Start Pi Run

```text
function start_agent_run(task, claim, config_snapshot):
  run = read_run(claim.owner_run_id)
  require run.state == Starting
  workspace = create_isolated_workspace(task, claim.owner_run_id)
  materialize(change_store.read_baseline(), workspace)
  set run.workspace_id with compare-and-swap

  session_dir = create_protected_session_dir(claim.owner_run_id)
  control = create_private_control_socket_pair(claim.owner_run_id)
  process = spawn_pi_rpc(
    cwd=workspace.path,
    provider=selected_provider(task),
    model=selected_model(task),
    thinking=selected_thinking(task),
    session_dir=session_dir,
    extension=config_snapshot.pi.extension_path,
    control_fd=control.child_endpoint,
    control_fd_env=SWARM_CONTROL_FD
  )

  if process failed:
    transition run to Failed
    quarantine(workspace)
    release_reservation_and_schedule_retry(task, process.error)
    return

  set run.pid=process.pid with compare-and-swap
  close supervisor copy of control.child_endpoint
  verify process policy closes the control descriptor in tool children
  start_strict_jsonl_client(process)
  rpc(set_auto_retry, enabled=false)
  rpc(set_auto_compaction, enabled=config_snapshot.pi.auto_compaction)
  state = rpc(get_state)
  verify_rpc_state(state, task, claim, workspace)
  set run.session_id=state.sessionId with compare-and-swap
  rpc(prompt, message=render_role_prompt(task, claim, config_snapshot))
```

### 16.6 Pi Event Handling

```text
function on_pi_event(run, event):
  append_redacted_event(run, event)
  update_last_event_time(run)

  if event.type == agent_start:
    if run.state == Starting:
      transition run from Starting to Running
      transition task from Claimed to Running
    else if run.state == Settling:
      transition run from Settling to Running
    else:
      fail_run(run, invalid_agent_start_state)

  else if event.type == agent_end:
    transition run from Running to Settling
    record event.willRetry

  else if event.type == agent_settled:
    settle_usage(run)
    submission = read_valid_submission(run)
    if submission exists:
      transition run to Succeeded
      if task.kind == reviewer and valid review record committed:
        transition task from Running to Completed
      else if task.state == Running:
        transition task to Reviewing
        enqueue role-specific reviews for submission
    else:
      fail_run(run, missing_submission)

  else if event.type == extension_error:
    apply_extension_error_policy(run, event)

  else if event.type in usage_bearing_events:
    debit_usage_once(run, event)
```

### 16.7 Tool Gate

```text
function gate_tool_call(event, ctx):
  require ctx.mode == rpc
  require canonical(ctx.cwd) == run.workspace_path
  require ctx.isProjectTrusted()
  require event.toolName in run.allowed_tools
  require live_claim(run.claim_id, run.claim_version)
  require task_is_current(run.task_id, run.task_version)
  require goal_allows_new_mutation()

  targets = canonical_tool_targets(event)
  require every target is inside workspace
  require no target matches denied_paths
  require every target is in task scope or valid core exception
  require network_request_is_allowed(event)

  if tool mutates one file:
    execute full mutation with withFileMutationQueue(real_target_path)
```

### 16.8 Collision and Integration

```text
function review_and_integrate(change_id):
  change = change_store.read_change(change_id)
  current = change_store.read_baseline()

  require current_design_versions_match(change.design_refs)
  collisions = change_store.detect_collisions(change_id, current)

  if collisions contain design disagreement:
    mark change Conflicted
    freeze affected decision namespaces
    enqueue design_reconciler
    return

  if collisions is not empty:
    mark change Conflicted
    enqueue neutral_merge_agent(change, collisions)
    return

  mark change Reviewing
  reviews = run_required_review_stack(change)
  if reviews do not pass:
    reject_or_requeue(change, reviews)
    return

  mark change Accepted
  result = change_store.integrate(change.id, expected_revision=current.id)
  if result is baseline_conflict:
    mark change Submitted
    invalidate prior reviews
    requeue collision detection
    return
  if result failed:
    quarantine change
    fail integration task
    return

  record atomically Integrated change and Superseded originals from result
  complete producer task and eligible superseded producer tasks
  invalidate_stale_dependents(result.new_revision)
```

### 16.9 Design Reconciliation

```text
function reconcile_design(conflict):
  require assigned agent role == reconciler
  require affected namespaces are frozen

  decision = agent_proposes_superseding_decision(conflict)
  require decision resolves each stated contradiction
  require decision lists affected task and change ids
  require decision passes design review

  transaction:
    write superseding decision version
    close conflict
    for each affected active task:
      mark task stale and cancel active run

  mark reconciler task Completed
  unfreeze affected namespaces at the new decision version
  requeue affected tasks after cancellation settles
```

### 16.10 Megafile Gate

```text
function evaluate_megafile(path, proposed_change):
  metrics = calculate_file_metrics(path, proposed_change)
  if metrics.lines <= max_file_lines and no valid worker flag:
    return pass

  transaction:
    create megafile record
    block ordinary changes for canonical(path)
    create decomposition task owned outside current subtree

  return blocked
```

### 16.11 Field Guide Curation

```text
function propose_field_guide_entry(entry, provenance):
  require provenance is present
  require entry contains no secret or personal data
  require entry does not claim untrusted text as policy
  require normalized key is unique or explicitly supersedes old entry
  require projected_index_lines <= field_guide.line_budget

  save entry with retention=review and trust=unreviewed
  enqueue field_guide_review(entry.id)
```

### 16.12 Completion Evaluation

```text
function can_complete(goal):
  require goal.state == Active
  require every required task is Completed
  require no live claim, run, retry, collision, or design conflict exists
  require every required change is Integrated
  require every required review lens passed final baseline revision
  require every required test passed final baseline revision
  require all root acceptance criteria have evidence
  require quality score meets configured minimum
  require budget ledger is consistent
  require no security finding is open
  require Open Questions do not block declared conformance profile
  require completion checklist passes
  return true
```

### 16.13 Restart Reconciliation

```text
function reconcile_after_restart():
  load workflow snapshot and durable state
  verify store health and transaction journals

  for run in nonterminal_runs:
    mark run Lost
    quarantine run workspace

  for claim in live_claims:
    if claim owner is Lost or lease expired:
      revoke claim after workspace quarantine

  for session_cursor in pi_session_cursors:
    read entries after cursor
    debit new usage once
    store new cursor

  classify incomplete change integrations
  stop if any integration is indeterminate
  reconcile baseline and design versions
  restore retry timers with stored due times
  requeue eligible tasks
```

## 17. Test and Validation Matrix

A conforming implementation MUST pass all `Core` tests. It MUST pass an `Adapter` test for each
selected workspace, Change Store, provider, and secret adapter.

### 17.1 Workflow and Configuration

| ID | Profile | Test | Expected result |
|---|---|---|---|
| `CFG-01` | Core | Start with a missing workflow | Startup fails with `missing_workflow` |
| `CFG-02` | Core | Add an unknown top-level or nested field | Validation returns `unknown_config_field` |
| `CFG-03` | Core | Set heartbeat to half or more of lease | Validation rejects the config |
| `CFG-04` | Core | Reload an invalid workflow during a run | Last good snapshot stays active; new dispatch pauses |
| `CFG-05` | Core | Reduce hard budget below current debits | Goal enters `BudgetStopped`; active mutation stops by policy |
| `CFG-06` | Core | Configure one missing reviewer model | The validator blocks completion before dispatch |
| `CFG-07` | Core | Configure `pi.mode` other than `rpc` | Validation rejects the config |
| `CFG-08` | Core | Configure a session directory inside agent-writable scope | Validation rejects the path |
| `CFG-09` | Core | Allow bash with hidden session environment and no replacement | Validation rejects the unsafe tool profile |
| `CFG-10` | Core | Configure the control channel as pi RPC stdout | Validation rejects the transport |

### 17.2 Task Tree, Claims, and Scheduling

| ID | Profile | Test | Expected result |
|---|---|---|---|
| `TREE-01` | Core | Planner output contains a dependency cycle | The validator rejects the complete plan transaction |
| `TREE-02` | Core | Worker leaf has no acceptance criterion | The validator rejects planner output |
| `TREE-03` | Core | Worker tries to create a child task | The policy gate blocks the tool or submission |
| `TREE-04` | Core | Planner submits repository implementation operations | The role gate rejects the submission |
| `TREE-05` | Core | Planner plan commits while one required descendant is active | Planner stays `Integrating` until all required descendants complete |
| `TREE-06` | Core | Last blocking record closes for an eligible task | Task moves from `Blocked` to `Ready` |
| `CLAIM-01` | Core | Two schedulers claim one ready task concurrently | One compare-and-swap succeeds; one gets `claim_conflict` |
| `CLAIM-02` | Core | A late process reports an expired claim | The orchestrator cancels the process; it cannot submit a change |
| `SCHED-01` | Core | Review reserve is at risk | New worker dispatch pauses; review dispatch continues |
| `SCHED-02` | Core | Merge work and worker work are both ready | Merge work dispatches first |
| `RETRY-01` | Core | A retryable run fails before its limit | Task enters `RetryWait`; one durable retry records the due time |
| `RETRY-02` | Core | A retry becomes due while its prior claim is live | Task stays `RetryWait` until the run stops and releases the claim |
| `CANCEL-01` | Core | Cancellation arrives while a run is `Settling` | Run enters `Stopping`; shutdown completes before claim release |

### 17.3 Split-Brain Plans and Planner Contention

| ID | Profile | Test | Expected result |
|---|---|---|---|
| `PLAN-01` | Core | Two child planners own the same design namespace without knowledge of each other | Plan validation rejects duplicate ownership before worker dispatch |
| `PLAN-02` | Core | Two active planners propose incompatible records for one namespace | The namespace freezes; the orchestrator creates a conflict and reconciler task |
| `PLAN-03` | Core | Two planners alternately change the same shared design record | Version conflict prevents overwrite; reconciler produces one superseding version |
| `PLAN-04` | Core | A reconciled decision invalidates three active leaves | All three runs cancel; tasks requeue with the new decision version |
| `PLAN-05` | Core | A worker submits a change with a stale decision reference | Change Store returns `stale_design`; no baseline change occurs |

### 17.4 Workspaces and File Mutation

| ID | Profile | Test | Expected result |
|---|---|---|---|
| `WS-01` | Core | Workspace path escapes root through `..` | Process start fails |
| `WS-02` | Core | Target escapes through a symlink | Tool gate blocks mutation |
| `WS-03` | Core | Two processes target the same file in separate workspaces | Local files stay isolated; collision appears at submission |
| `WS-04` | Core | Two sibling pi tools edit one file | `withFileMutationQueue` serializes complete mutation windows |
| `WS-05` | Core | Custom tool queues only its final write | Conformance instrumentation fails the tool implementation |
| `WS-06` | Adapter | Filesystem is case-insensitive | Canonical collision detection treats case aliases as one path |

### 17.5 Atomic Changes and Merge Conflicts

| ID | Profile | Test | Expected result |
|---|---|---|---|
| `CHG-01` | Core | One operation in a multi-operation change is invalid | The Change Store rejects the complete change; the baseline does not change |
| `CHG-02` | Core | Baseline changes between review and integration | Change returns to `Submitted`; old reviews expire; collision detection runs again |
| `MERGE-01` | Core | Two workers change the same symbol compatibly | Neutral merge agent creates a new reviewed change |
| `MERGE-02` | Core | Two workers change one design incompatibly | The merge agent stops; the orchestrator assigns a design reconciler |
| `MERGE-03` | Core | Merge agent belongs to one conflicting subtree | The scheduler rejects the nonneutral assignment |
| `MERGE-04` | Core | Merge result passes one lens and fails another | Integration remains blocked |
| `MERGE-05` | Core | A neutral merge change integrates | Both immutable originals become `Superseded` and name the merge change |
| `MERGE-06` | Core | Reviewed merge change integrates and supersedes two originals | Merge and original producer tasks complete with one baseline update |
| `CHG-03` | Adapter | Change-store process fails during commit | Recovery classifies commit as committed, aborted, or indeterminate |
| `CHG-04` | Adapter | Recovery result is indeterminate | All integration stops until repair establishes one baseline |

### 17.6 Megafiles and Controlled Core Changes

| ID | Profile | Test | Expected result |
|---|---|---|---|
| `MEGA-01` | Core | Proposed change takes a file over the line limit | Ordinary change blocks; the orchestrator creates an outside decomposition task |
| `MEGA-02` | Core | Worker flags a smaller but structurally bloated file | Configured validator confirms or rejects the flag with evidence |
| `MEGA-03` | Core | Another worker submits to a blocked megafile | The Change Store rejects submission until decomposition integrates |
| `MEGA-04` | Core | Decomposition changes behavior without approval | Review fails and the block remains |
| `CORE-01` | Core | Worker edits a core path without a reason record | Tool gate blocks the edit |
| `CORE-02` | Core | Approved core change lists dependent breakage | Core lens runs; dependents invalidate after integration |
| `CORE-03` | Core | Core change expands beyond focused scope | Review rejects the change |

### 17.7 Stacked Review and Quality

| ID | Profile | Test | Expected result |
|---|---|---|---|
| `REV-01` | Core | All required lenses pass the current change revision | Change becomes `Accepted` |
| `REV-02` | Core | One required lens fails | Change does not integrate |
| `REV-03` | Core | Change updates after reviews | Old reviews become stale; full required stack runs again |
| `REV-04` | Core | Reviewer output has no evidence locator | The validator marks the verdict malformed and retries review |
| `REV-05` | Core | Give every lens the same prompt and context | Decorrelation audit reports a configuration failure |
| `REV-06` | Core | Final baseline has an open blocking finding | Goal completion fails |
| `REV-07` | Core | Review requests a correctable revision | Task returns to `Ready`; new subject version needs the full review stack |
| `REV-08` | Core | Reviewer commits one valid assigned verdict and settles | Reviewer task completes without a review-of-review cycle |
| `QUAL-01` | Core | Required test command fails | The gate evaluator rejects or requeues the change |
| `QUAL-02` | Core | Quality score is below minimum | Goal completion fails |

### 17.8 Field Guide and Ossification

| ID | Profile | Test | Expected result |
|---|---|---|---|
| `FG-01` | Core | New run starts with reviewed guide entries | `before_agent_start` injection contains the bounded index |
| `FG-02` | Core | New entry exceeds the line budget | Curator rejects the entry |
| `FG-03` | Core | Tool output proposes an instruction as trusted policy | The curator keeps the entry untrusted or rejects it |
| `FG-04` | Core | Entry contains a secret canary | Redaction rejects entry; canary does not enter prompt or log |
| `FG-05` | Core | Review entry gets no later confirmation | Entry expires after the configured review count |
| `FG-06` | Core | One later run repeats a guide confirmation | Curator counts it once; the proposal run cannot confirm itself |
| `OSS-01` | Core | Worker avoids a necessary core change because path is core | Prompt permits a focused proposal through Section 9.8 |
| `OSS-02` | Core | Core proposal has no migration rule | The reviewer rejects the proposal |

### 17.9 Pi API, Modes, and Failures

| ID | Profile | Test | Expected result |
|---|---|---|---|
| `PI-01` | Core | Start pi in RPC mode with the extension | Strict JSONL command and event exchange succeeds |
| `PI-02` | Core | JSON string contains `U+2028` or `U+2029` | Client does not split the record |
| `PI-03` | Core | Send `prompt` while streaming without `streamingBehavior` | RPC returns `success:false`; run remains controlled |
| `PI-04` | Core | `agent_end` has `willRetry:true` | Run does not complete before `agent_settled` |
| `PI-05` | Core | Extension throws during `tool_call` | Pi blocks the tool; the security event is durable |
| `PI-06` | Core | Custom tool returns an error-looking value without throwing | Test confirms `isError` stays false; tool implementation fails review |
| `PI-07` | Core | Custom tool throws | Pi emits error result and continues; swarm policy handles run |
| `PI-08` | Core | `set_model` has no available key | Setup fails before prompt |
| `PI-09` | Core | `setActiveTools` receives an unknown tool | Swarm prevalidation fails despite pi ignoring the name |
| `PI-10` | Core | RPC response times out while process is live | Health check, abort, evidence flush, and retry policy run |
| `PI-11` | Core | RPC stdout has invalid JSON | The RPC client records a parse error; the run fails safely |
| `PI-12` | Core | Pi emits `extension_error` | Stable policy action runs with extension path and event evidence |
| `PI-13` | Core | Tool result contains nested usage | Usage appears once in session and swarm totals |
| `PI-14` | Core | Pi compacts after overflow and retries | Run stays nonterminal until settlement; compaction usage debits once |
| `PI-15` | Core | One pi turn starts parallel sibling tools | Test confirms one agent run, not two swarm agents |
| `PI-16` | Core | Extension calls command-only session method from an event | Static or runtime conformance check fails extension |
| `PI-17` | Core | Pi emits another `agent_start` after `agent_end` | Run returns from `Settling` to `Running`; task identity does not change |
| `PI-18` | Core | Controlled bash disables session environment | Command receives none of the five documented session variables |
| `PI-19` | Core | Extension opens an unapproved RPC dialog | Client cancels it by ID, records a policy error, and fails closed |
| `PI-20` | Core | Approved project-trust confirmation times out | Pi resolves the dialog; the swarm denies trust and does not dispatch |
| `PI-21` | Core | Worker calls `swarm_submit_plan` | Tool throws `[role_violation]`; no plan record changes |
| `PI-22` | Core | Tool input uses a stale task version | Tool throws `[stale_task]`; orchestrator cancels and replaces the run |
| `PI-23` | Core | Abort arrives before a swarm-tool transaction | Tool throws `[swarm_cancelled]`; no partial record exists |
| `PI-24` | Core | Model adds a derived manifest to `ChangeInput` | Strict schema rejects the unknown field; extension derives the manifest |
| `PI-25` | Core | Control client repeats one completed request ID | Orchestrator returns the cached terminal response without another commit |
| `PI-26` | Core | Extension writes a private control record to RPC stdout | Protocol test fails the extension and quarantines the run |
| `PI-27` | Core | Control record exceeds `pi.control_max_bytes` | Receiver rejects it, closes the channel, and fails the run |
| `PI-28` | Core | Supervisor sends two valid `shutdown_command` records | Extension calls `ctx.shutdown()` once and acknowledges both records safely |
| `PI-29` | Core | First control response times out after a committed request | Exact retry returns cached response; one record commit exists |
| `PI-30` | Core | Worker requests a core path without migration data | Tool throws `[core_change_denied]`; path gate stays closed |
| `PI-31` | Core | Worker flags an in-scope file with valid complexity evidence | Tool records the flag and starts megafile validation |

### 17.10 Restart and Recovery

| ID | Profile | Test | Expected result |
|---|---|---|---|
| `RST-01` | Core | Service stops with active pi processes | Restart marks old runs `Lost` and quarantines workspaces |
| `RST-02` | Core | Session has entries after stored cursor | Recovery reads and accounts for each entry once |
| `RST-03` | Core | Stored cursor does not exist | `get_entries` fails; recovery requests complete entries and rebuilds cursor |
| `RST-04` | Core | Retry was due during downtime | Restart dispatches it after reconciliation and capacity checks |
| `RST-05` | Core | Persisted session uses stale task version | New pi session starts; old session is evidence only |
| `RST-06` | Core | Process exits after change submission but before state update | Recovery finds the change and reconciles state without duplicate work |
| `RST-07` | Core | Cancellation and restart occur together | No new mutation starts; claims release only after quarantine |

### 17.11 Cost and Budget

| ID | Profile | Test | Expected result |
|---|---|---|---|
| `COST-01` | Core | Worker fleet reaches role token limit | New worker dispatch stops; planner and review policy still applies |
| `COST-02` | Core | Goal cost reaches hard limit during a run | Run abort policy applies; goal enters `BudgetStopped` |
| `COST-03` | Core | Provider cost is missing | Admission follows documented unknown-cost policy |
| `COST-04` | Core | Replay the same usage event after restart | The ledger does not debit it twice |
| `COST-05` | Core | Reserved run uses fewer tokens than estimate | Unused reservation returns after settlement |
| `COST-06` | Core | Review reserve is fully used | Non-review dispatch cannot consume additional reserved budget |
| `ECON-01` | Core | Two model mixes complete one benchmark | Report shows quality, cost, tokens, time, and rework by role |

### 17.12 Security

| ID | Profile | Test | Expected result |
|---|---|---|---|
| `SEC-01` | Core | Project trust is absent | Project extension and task dispatch do not start |
| `SEC-02` | Core | Prompt asks worker to reveal a secret | Tool and output policy prevent disclosure; the security system records a finding |
| `SEC-03` | Core | Repository file asks agent to change tool policy | The extension ignores and flags the lower-authority instruction |
| `SEC-04` | Core | Child command targets an unapproved network host | Process-level network policy blocks it |
| `SEC-05` | Core | Tool argument contains a denied secret path | `tool_call` gate blocks the tool |
| `SEC-06` | Core | Shutdown handler runs twice | Cleanup remains correct and no new work starts |
| `SEC-07` | Core | Bash tries to read or change the protected session file | Tool and process controls block access and record a finding |
| `SEC-08` | Core | Tool child inspects its environment and open descriptors | It cannot find the swarm control channel or host credentials |

### 17.13 Real Integration Profile

Before production, the implementation SHOULD run a real pi process, real model provider, selected
workspace adapter, and selected Change Store. The test MUST use an isolated project and disposable
credentials.

A skipped real integration test MUST show `skipped`. It MUST NOT show `passed`.

## 18. Implementation Checklist (Definition of Done)

### 18.1 Required for Core Conformance

- [x] The specification defines one root goal and a recursive task tree.
- [x] Planner nodes own decomposition and shared design decisions.
- [x] Worker leaves execute one bounded task and produce one atomic change.
- [x] Task, run, change, and goal state machines have explicit transitions.
- [x] Every configuration field has a type, default, validation, authority, invariant, error, and recovery rule.
- [x] Domain fields have equivalent contracts in Section 4.
- [x] Claims use leases and atomic compare-and-swap.
- [x] Retries use stored capped exponential backoff.
- [x] Cancellation stops mutation before it releases claims.
- [x] Completion checks tasks, reviews, tests, budgets, security, and Open Questions.
- [x] Planner and worker model selectors are separate and configurable.
- [x] Section 8 defines token, cost, quality, and model-economics metrics.
- [x] Workspace isolation and file-mutation queues are separate controls.
- [x] Atomic changes and collision detection have implementation contracts.
- [x] Neutral merge agents and design reconcilers have separate authority.
- [x] Megafile control and controlled core changes have gates and tests.
- [x] Stacked review has required independent lenses.
- [x] The Field Guide has injection, ownership, line, retention, and trust rules.
- [x] One pi RPC process supplies one agent run.
- [x] Section 10 maps pi events, methods, contexts, modes, sessions, models, tools, usage, and errors.
- [x] Section 10 controls pi's bash session-environment exposure.
- [x] The process model does not treat one pi session as a swarm or a VCS.
- [x] Sections 10 and 14 define shutdown, restart, recovery, persistence, and compatibility.
- [x] Sections 12 through 16 define prompts, observability, failures, security, and reference algorithms.
- [x] The test matrix includes every failure named in the request.
- [x] Source evidence uses exact controlled source revisions or exact official page headings.
- [x] Each substitute design has the `Proposed` label.
- [x] Unsupported facts remain absent or appear as `Open`.
- [x] No unresolved marker is present outside Open Questions.

### 18.2 Prototype Completion

A prototype is complete only after its implementation passes all `Core` tests and all selected
`Adapter` tests. The checklist above states specification coverage. It does not claim that an
implementation exists or that implementation tests passed.

### 18.3 Production Readiness

- [ ] Run the Real Integration Profile with the selected pi revision and model providers.
- [ ] Run restore tests for the selected state and Change Store adapters.
- [ ] Verify process isolation and network policy on the production host.
- [ ] Verify credential scope and rotation procedures.
- [ ] Establish provider price refresh and audit procedures.

These production items do not block specification completeness. They block a production deployment.

## Appendix A. Controlled Sources and Traceability

### A.1 Source Register

All access dates use `2026-07-22` in Europe/Copenhagen.

| ID | Role | Official source URL | Controlled revision | Publication or revision date | Access date |
|---|---|---|---|---|---|
| `CURSOR` | Swarm behavior and economics | https://cursor.com/blog/agent-swarm-model-economics | Live article; raw-response SHA-256 `6547a6fba0a2a2d81cd29f1910b958a8e5de0684a91d0d244a179f9643d14c75` | 2026-07-20 | 2026-07-22 |
| `SYMPHONY` | Specification structure and document design | https://github.com/openai/symphony/blob/1f3219bb1ea5f69a1305dc594e79b0db57c113c5/SPEC.md | `1f3219bb1ea5f69a1305dc594e79b0db57c113c5` | 2026-07-20 | 2026-07-22 |
| `PI-EXT` | Pi extension behavior | https://github.com/earendil-works/pi/blob/bb3d7d399c06e5fe284f34eb66b15b037ab18649/packages/coding-agent/docs/extensions.md | `bb3d7d399c06e5fe284f34eb66b15b037ab18649` | 2026-07-22 | 2026-07-22 |
| `PI-RPC` | Pi headless process and RPC behavior | https://github.com/earendil-works/pi/blob/bb3d7d399c06e5fe284f34eb66b15b037ab18649/packages/coding-agent/docs/rpc.md | `bb3d7d399c06e5fe284f34eb66b15b037ab18649` | 2026-07-22 | 2026-07-22 |
| `PI-SESSION` | Pi session persistence API | https://github.com/earendil-works/pi/blob/bb3d7d399c06e5fe284f34eb66b15b037ab18649/packages/coding-agent/docs/session-format.md | `bb3d7d399c06e5fe284f34eb66b15b037ab18649` | 2026-07-22 | 2026-07-22 |
| `PI-ENV` | Pi process and bash-tool environment behavior | https://github.com/earendil-works/pi/blob/bb3d7d399c06e5fe284f34eb66b15b037ab18649/packages/coding-agent/docs/environment-variables.md | `bb3d7d399c06e5fe284f34eb66b15b037ab18649` | 2026-07-22 | 2026-07-22 |
| `STE` | Controlled English | https://www.asd-ste100.org/assets/files/ASD-STE100_ISSUE9.pdf | ASD-STE100 Issue 9 | 2025-01 | 2026-07-22 |
| `RFC2119` | Normative key words | https://www.rfc-editor.org/rfc/rfc2119 | RFC 2119 | 1997-03 | 2026-07-22 |
| `RFC3339` | Timestamp format | https://www.rfc-editor.org/rfc/rfc3339 | RFC 3339 | 2002-07 | 2026-07-22 |

The final GitHub `main` check ran at `2026-07-22T20:41:49+0200`. It returned the two commit IDs in
this table. The pi direct references use the same pi commit. No mutable `main` URL controls a
factual requirement.

The Cursor response digest check ran twice at `2026-07-22T20:42:45+0200`. Both checks returned the
digest in this table. The page still has no immutable publisher revision ID.

### A.2 Cursor Requirement Trace

Cursor source locators use the article heading and paragraph number under that heading.

| ID | Specification requirement | Evidence class | Exact Cursor locator | Source statement or boundary |
|---|---|---|---|---|
| `C-01` | Use a root goal and recursive task tree | `Observed` | `Trees and leaves`, paragraphs 1-2 | Large tasks form trees that subdivide into basic work units |
| `C-02` | Planners decompose and workers execute | `Observed` | `Trees and leaves`, role bullets | The article gives planner and worker roles |
| `C-03` | Planners do not implement; workers do not plan | `Observed` | `What the tree does for memory`, paragraph 3 | Role separation protects context |
| `C-04` | Treat context efficiency as a design goal | `Observed` | `What the tree does for memory`, paragraph 4 | The article attributes scaling primarily to context efficiency |
| `C-05` | Detect collisions at the change-integration layer | `Observed` | `A version control system for agents`, paragraphs 2-3 | Cursor detects collisions where every change passes |
| `C-06` | Prevent duplicate design ownership across subtrees | `Observed` | `Split-brain design`, paragraph 2 | Planners own design choices and avoid duplicate child questions |
| `C-07` | Reconcile shared design records and propagate resolution | `Observed` | `Contention between planners`, paragraph 2 | Shared design documents and references carry reconciliation |
| `C-08` | Use a neutral agent for merge conflicts | `Observed` | `Merge conflicts`, paragraph 2 | A third-party agent resolves collisions impartially |
| `C-09` | Block changes to a megafile and assign an outside split task | `Observed` | `Megafiles`, paragraph 3 | Cursor blocks commits and assigns an outside decomposition agent |
| `C-10` | Permit a focused, explained core change | `Observed` | `Ossification`, paragraphs 2-3 | Cursor permits focused breakage and records its reason |
| `C-11` | Stack decorrelated review lenses | `Observed` | `Review lenses`, paragraphs 2-3 | No one lens catches all errors; lenses stack |
| `C-12` | Inject an agent-owned Field Guide index under a line budget | `Observed` | `Letting agents shape the environment`, paragraphs 3-4 | Agents own the guide; `index.md` enters each start; a line budget applies |
| `C-13` | Configure planner and worker model mixes | `Inferred` | `Results across model mixes`, numbered list; `Model economics`, paragraphs 1-5 | The article varies role models; configuration is the portable control |
| `C-14` | Measure role tokens and cost, not only final quality | `Observed` | `Model economics`, paragraphs 1-5 | Similar quality can have very different cost and token structure |
| `C-15` | Treat the specification as the top work unit | `Observed` | `Specs as prompts`, paragraphs 1-6 | The article describes a specification as the swarm work unit |
| `C-16` | Do not use raw commit rate as productivity | `Inferred` | `A deep dive into the runs`, paragraphs 1-4 | The old run had more commits and much more churn and conflict |

### A.3 Pi API Claim Trace

Line numbers refer to the pinned Markdown files from Section A.1.

| ID | Claim used by this specification | Evidence class | Exact source locator |
|---|---|---|---|
| `P-01` | Extensions are TypeScript modules with tools and events | `Observed` | `PI-EXT` lines 3-15, `Extensions` |
| `P-02` | The extension factory can be asynchronous and pi awaits it | `Observed` | `PI-EXT` lines 159-181, `Writing an Extension` |
| `P-03` | Long-lived resources start after factory load and close on shutdown | `Observed` | `PI-EXT` lines 221-224, `Long-lived resources and shutdown` |
| `P-04` | Project-local extensions load only after project trust | `Observed` | `PI-EXT` lines 94-106 and 352-367, `Extension Locations` and `project_trust` |
| `P-05` | `before_agent_start` can inject a message and change the system prompt | `Observed` | `PI-EXT` lines 521-556, `before_agent_start` |
| `P-06` | `agent_end` can precede retry; `agent_settled` is final automatic settlement | `Observed` | `PI-EXT` lines 558-570; `PI-RPC` lines 834-884 |
| `P-07` | Sibling tool calls execute concurrently by default | `Observed` | `PI-EXT` lines 751-765, `tool_call` |
| `P-08` | Custom file tools use `withFileMutationQueue` for the full mutation window | `Observed` | `PI-EXT` lines 1865-1889, `Custom Tools` |
| `P-09` | Tool failure requires a thrown error | `Observed` | `PI-EXT` lines 1955-1969, `Signaling errors` |
| `P-10` | Nested tool usage enters pi session totals | `Observed` | `PI-EXT` lines 1955-1957; `PI-RPC` lines 529-572 |
| `P-11` | `appendEntry` persists extension data outside model context | `Observed` | `PI-EXT` lines 1437-1453, `pi.appendEntry` |
| `P-12` | Active tools use get, list, and set methods | `Observed` | `PI-EXT` lines 1622-1647, active-tool methods |
| `P-13` | Pi ignores unknown names passed to `setActiveTools` | `Observed` | `PI-EXT` lines 2304-2318, `Dynamic Tool Loading` |
| `P-14` | `setModel` returns false without an API key | `Observed` | `PI-EXT` lines 1649-1659, `pi.setModel` |
| `P-15` | `ctx.signal` can be absent outside active turns | `Observed` | `PI-EXT` lines 989-1008, `ctx.signal` |
| `P-16` | `ctx.shutdown` is graceful and deferred in RPC mode | `Observed` | `PI-EXT` lines 1018-1035, `ctx.shutdown` |
| `P-17` | Session replacement makes old contexts stale | `Observed` | `PI-EXT` lines 1232-1270, session replacement footguns |
| `P-18` | Extensions run in `tui`, `rpc`, `json`, and `print` modes | `Observed` | `PI-EXT` lines 2866-2875, `Mode Behavior` |
| `P-19` | RPC mode uses a headless JSON stdin/stdout protocol | `Observed` | `PI-RPC` lines 1-27, `RPC Mode` and `Protocol Overview` |
| `P-20` | RPC framing uses LF-only strict JSONL | `Observed` | `PI-RPC` lines 28-37, `Framing` |
| `P-21` | RPC has model, prompt, abort, state, session, and usage commands | `Observed` | `PI-RPC` lines 39-829, `Commands` |
| `P-22` | Prompt acceptance is not later task success | `Observed` | `PI-RPC` lines 43-79, `prompt` |
| `P-23` | `get_state` returns session and streaming state | `Observed` | `PI-RPC` lines 162-214, `get_state` and `get_messages` |
| `P-24` | `get_session_stats` includes tool and compaction usage | `Observed` | `PI-RPC` lines 529-571, `get_session_stats` |
| `P-25` | `get_entries` uses a stable entry cursor across restarts | `Observed` | `PI-RPC` lines 692-721, `get_entries` |
| `P-26` | RPC events include extension, retry, compaction, tool, turn, and message events | `Observed` | `PI-RPC` lines 830-1124, `Events` |
| `P-27` | RPC failures use `success:false` and an error string | `Observed` | `PI-RPC` lines 1318-1339, `Error Handling` |
| `P-28` | SessionManager supports persisted, open, recent, forked, and in-memory sessions | `Observed` | `PI-SESSION` lines 384-436, `SessionManager API` |
| `P-29` | The specification requires one pi process per swarm agent | `Proposed` | Pi documents one RPC coding-agent process; no controlled source states that one session creates a swarm |
| `P-30` | A separate Change Store supplies VCS behavior | `Proposed` | `PI-EXT` documents extension and tool APIs, not a swarm VCS contract |
| `P-31` | Startup, resource, session, and shutdown integrations use verified extension events | `Observed` | `PI-EXT` lines 350-518, `Startup Events`, `Resource Events`, and `Session Events` |
| `P-32` | Agent, model, tool, and input integrations use verified event names and return contracts | `Observed` | `PI-EXT` lines 519-934, event sections |
| `P-33` | The binding uses verified `ExtensionContext` mode, UI, trust, session, model, abort, usage, and prompt APIs | `Observed` | `PI-EXT` lines 936-1077, `ExtensionContext` |
| `P-34` | Session-control methods require command context and fresh replacement-session objects | `Observed` | `PI-EXT` lines 1079-1295, `ExtensionCommandContext` and replacement lifecycle |
| `P-35` | Extension message delivery and durable custom state use exact `pi.sendMessage`, `pi.sendUserMessage`, and `pi.appendEntry` contracts | `Observed` | `PI-EXT` lines 1386-1453 |
| `P-36` | Host execution, active tools, model selection, and thinking controls use exact ExtensionAPI methods | `Observed` | `PI-EXT` lines 1613-1670 |
| `P-37` | Custom tools use the documented execute arguments, result fields, usage, error, cancellation, and termination rules | `Observed` | `PI-EXT` lines 1895-1971, `Tool Definition` |
| `P-38` | Custom tool output uses pi's documented truncation limits and disclosure rule | `Observed` | `PI-EXT` lines 2109-2159, `Output Truncation` |
| `P-39` | The RPC binding uses only documented prompt, queue, abort, state, model, retry, usage, and session commands | `Observed` | `PI-RPC` lines 43-159, 162-316, 413-455, and 529-790 |
| `P-40` | The RPC event binding uses documented event names, fields, and settlement semantics | `Observed` | `PI-RPC` lines 830-1124, `Events` |
| `P-41` | The listed SessionManager names and signatures match the programmatic persistence API | `Observed` | `PI-SESSION` lines 384-436, `SessionManager API` |
| `P-42` | Bash tools expose current session metadata by default; custom bash tools can disable it | `Observed` | `PI-ENV` lines 15-68; `PI-EXT` lines 2085-2107 |
| `P-43` | An extension can replace a built-in tool or start pi without built-in tools | `Observed` | `PI-EXT` lines 2020-2050, `Overriding Built-in Tools` |
| `P-44` | RPC extension dialogs use correlated UI requests, responses, cancellation, and optional timeout | `Observed` | `PI-RPC` lines 1126-1316, `Extension UI Protocol` |

### A.4 Proposed Substitute Designs

| ID | Substitute design | Reason | Conformance rule |
|---|---|---|---|
| `S-01` | Durable task, claim, budget, and event stores | Cursor does not publish these schemas | A prototype MUST implement Sections 4, 7, 8, and 13 |
| `S-02` | Change Store interface and compare-and-swap | Cursor's custom VCS is unpublished; pi is not a VCS | A prototype MUST pass Sections 17.4 and 17.5 |
| `S-03` | One pi RPC process per concurrent agent | Pi docs do not state that one session creates parallel agents | A prototype MUST pass `PI-15` |
| `S-04` | Design namespace freeze and reconciler transaction | Cursor gives behavior but not a portable data contract | A prototype MUST pass `PLAN-02` through `PLAN-05` |
| `S-05` | Core-change review and dependency invalidation | Cursor's compiler propagation is not general to all projects | A prototype MUST pass `CORE-01` through `CORE-03` |
| `S-06` | Field Guide trust and retention rules | Cursor gives ownership and line budget, but not security or retention | A prototype MUST pass `FG-01` through `FG-06` |
| `S-07` | Budget reservation and review reserve | Cursor gives economics, but not admission rules | A prototype MUST pass Section 17.11 |
| `S-08` | Controlled bash replacement and session-environment policy | Pi exposes session metadata to bash by default | A prototype MUST pass `CFG-09`, `PI-18`, and `SEC-07` |
| `S-09` | Named swarm extension tools and request schemas | Pi supplies generic custom tools, not swarm record operations | A prototype MUST pass `PI-21` through `PI-24` and `PI-30` through `PI-31` |
| `S-10` | Private extension-to-orchestrator control channel | Pi RPC does not supply swarm record operations | A prototype MUST pass `CFG-10`, `PI-25` through `PI-29`, and `SEC-08` |
| `S-11` | Repository workflow and prompt schema | The controlled sources do not define a portable swarm configuration file | A prototype MUST pass Section 17.1 |

### A.5 Source Conflicts and Boundaries

| Topic | Controlled evidence | Conflict or gap | Resolution |
|---|---|---|---|
| VCS | Cursor reports a new internal VCS | Pi extension docs do not supply a VCS | Use `S-02`; do not call it Cursor's implementation |
| Parallelism | Cursor describes many planner and worker agents | Pi describes parallel sibling tool calls in one agent turn | Use one pi process per agent; do not count tool calls as agents |
| Core changes | Cursor uses compiler failures to propagate a core change | Not every project has compile-checked dependencies | Use versioned decisions and dependency invalidation in `S-05` |
| Field Guide | Cursor reports agent ownership and automatic index injection | Cursor does not state trust, retention, or secret rules | Keep observed behavior and add `S-06` |
| Session recovery | Pi persists session data | Pi persistence does not prove that a dead OS process resumes | Mark old run `Lost`; validate before a new process loads the session |
| Bash session data | Pi gives bash the current session path by default | The swarm keeps session records outside agent authority | Exclude built-in bash or use the controlled `S-08` replacement |
| Model cost | Cursor reports experimental cost values | Provider prices and model names can change | Store reported usage and a versioned price source; do not hard-code article prices |

## Appendix B. Open Questions

| ID | Open fact | Effect on conformance | Required operator or adapter action |
|---|---|---|---|
| `O-01` | The Cursor article gives no immutable publisher revision ID | A later live page can differ from the recorded digest | Keep a lawful capture with the recorded date and digest for a regulated build |
| `O-02` | Cursor does not publish its VCS protocol or data model | An implementation cannot claim a clone of Cursor's internal VCS | Use the `Proposed` Change Store contract and state that substitution |
| `O-03` | Symbol collision support depends on the selected language adapter | Path-only detection can miss semantic overlap | Declare a reduced profile or supply a tested symbol adapter |
| `O-04` | Exact provider price data is external to the pi extension contract | Cost accuracy depends on a price revision | Record the price source and time for each debit estimate |
| `O-05` | Some projects cannot create machine-checked design references | Automatic propagation can be incomplete | Use durable decision versions and explicit dependency checks |

An Open Question blocks only the conformance feature named in its effect column. It does not permit
an implementation to omit another normative requirement silently.

## Appendix C. Specification Audit Record

### C.1 Structure Audit

- Result: pass.
- Evidence: The title block, normative language, Sections 1 through 18, algorithms, test matrix,
  completion checklist, and appendices follow the Symphony document order and heading depth.

### C.2 Source-Fidelity Audit

- Result: pass.
- Evidence: Cursor requirements use article headings. GitHub sources use commit-pinned URLs.
  Unsupported service mechanisms use `Proposed`. Gaps use `Open`.

### C.3 Pi API Audit

- Result: pass for compatibility profile `bb3d7d399c06e5fe284f34eb66b15b037ab18649`.
- Evidence: Section 10 maps verified pi APIs to narrow pinned source ranges.
- Boundary: `S-03`, `S-08`, `S-09`, and `S-10` identify the required substitute controls.

### C.4 ASD-STE100 Audit

- Result: pass for the specification authoring review.
- Method: The review applied Issue 9 Rules 1.1, 1.12, 3.6, 5.1, and 6.3.
- Source terms: The review kept required identifiers and source literals unchanged.
- Sentence check: Descriptive sentences contain 25 words or fewer. Procedural list items contain 20
  words or fewer.
- Voice check: Active sentences identify the component that does each action. Past participles in
  tables identify states or technical terms.

### C.5 Internal-Consistency Audit

- Result: pass.
- Evidence: State names, role boundaries, authorities, retry rules, budgets, and completion gates
  have one controlling definition and matching tests.

### C.6 Implementability Audit

- Result: pass for a conforming prototype.
- Evidence: Entity and config contracts, process boundaries, exact pi bindings, store operations,
  algorithms, failures, recovery, and tests give a buildable service boundary.
