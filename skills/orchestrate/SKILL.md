---
name: orchestrate
description: "Orchestrate when the user explicitly invokes this skill, or when work requires parallel decomposition: independent scouting, disjoint implementation ownership, independent review, or context partitioning."
---

# Orchestrate

A manual invocation is a direct decision to orchestrate. Main communicates with the user. Main makes decisions, gets approvals, combines results, and checks the final evidence. Approved workers do the groundwork: research, code changes, tests, and reviews. Main can delegate a check. Main decides whether the evidence proves the requested result.

## 1. Frame

State the requested outcome and its smallest convincing proof. Choose the simplest worker arrangement: a specialist, scout fan-out, owned implementation slices, an ordered pipeline, independent reviewers, a persistent team, or recursive partitions.

Define each work item by outcome, disjoint scope, owner, dependencies, access, output format, and completion criterion. One specialist plus Main is valid when parallelism would add no value.

**Done:** every necessary item is owned, bounded, and either independent or dependency-ordered.

## 2. Bound

Discover available workers and capabilities at runtime. Load the active harness’s approved groundwork pool. Compare the approved pool with workers available now. Assign each delegated item to an available pool member explicitly. A worker outside the pool requires explicit user approval. When no approved capable worker exists, pause before dispatch and report the gap.

Set limits for worker count, run time, and cost. Scouts receive read-only access. Writers own separate writable paths or files or isolated workspaces. Leaves execute their assigned item. Recursion belongs only to an item explicitly tasked with decomposition.

**Done:** every worker is available, approved, and limited to the capability and budget its item needs. Each writable path or file has one writer.

## 3. Dispatch

Launch independent items concurrently and dependent items sequentially. Give every worker a self-contained brief containing the objective, relevant context or paths, scope, constraints, acceptance criterion, and expected response. Identify the user and project instructions that apply to each worker. Put those instructions in the brief unless the harness supplies them.

Use low reasoning effort for narrow scouts, medium for routine execution, and high for hard judgment or implementation. Treat these as intent and map them to the active harness.

**Done:** every dispatched item can be evaluated without reconstructing the assignment.

## 4. Reconcile

Track requested, dispatched, completed, failed, and deferred items. Redirect an off-track worker when its context remains useful. Retry only uncovered gaps; after a systemic failure, stop scheduling and return control to the user.

Integrate completed evidence and change sets. Resolve conflicts. Record disagreements that can affect the result. Compare each result with its task criteria and applicable instructions before Main accepts it. Treat partial results as partial rather than filling gaps by inference.

**Done:** every item is accepted, retried, or explicitly deferred with its effect on coverage stated.

## 5. Prove

Verify the user workflow in the target environment with real data and required providers. Tests, mocks, and worker reports are not final proof. If required access, authentication, or verification is unavailable, stop and tell the user.

**Done:** the real workflow succeeds, or missing access is reported as a blocker.

## Runtime adapter

When Pi Fabric agent APIs are available, first follow [Pi Fabric onboarding](references/onboarding.md), then read [the Pi Fabric adapter](references/pi-fabric.md) and [topology map](references/topology.md) before dispatch. Advanced Fabric skills are user-invoked only: recommend them with their exact `/skill:<name>` command and await the user's invocation. On other harnesses, map the same concepts—worker, handle, isolation, steering, lifecycle, and proof—to native primitives without changing this protocol.
