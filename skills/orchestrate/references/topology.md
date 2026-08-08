# Pi Fabric topology map

Use core Fabric primitives directly for finite specialist, scout fan-out, owned implementation slices, pipeline, and simple independent-reviewer work, applying the bounded role defaults in `../agents/profile.yaml` and explicit models described in [pi-fabric.md](pi-fabric.md). Persistent teams and recursive partitions must instead recommend `/skill:fabric-swarm` or `/skill:fabric-rlm`, respectively, and await the user's explicit invocation; do not launch that advanced machinery directly.

| Arrangement | Core Fabric mapping |
| --- | --- |
| Specialist | one bounded `agents.run()` or `agent()` call |
| Scout fan-out | read-only scout calls in `Promise.all` / `parallel()` with finite concurrency |
| Owned implementation slices | one builder per disjoint path; use `worktree: true` when isolation is needed, then integrate and `agents.cleanup({ id })` |
| Pipeline | `pipeline()` stages per item, with bounded cross-item concurrency |
| Independent reviewers | read-only reviewer calls, then Main reconciles evidence |
| Persistent team | recommend `/skill:fabric-swarm` and await user invocation |
| Recursive partition | recommend `/skill:fabric-rlm` and await user invocation |

Use `agents.spawn()` plus `agents.wait({ id })` when Main can do useful work before a result is needed; otherwise use `agents.run()`. For execution-budget semantics, see [pi-fabric.md](pi-fabric.md). Read-only tool allowlists provide scout/reviewer access; `extensions: false` and `recursive: false` keep ordinary leaves non-recursive.

For a named advanced pattern, use Fabric Guide as the recommendation source of truth. Recommend the exact command and await the user's explicit invocation; never load or auto-invoke it:

- Finite dashboard workflow: `/skill:fabric-workflow`
- Durable actor team: `/skill:fabric-swarm`
- Strict feature-spec audit: `/skill:fabric-spec`
- Independent review and synthesis: `/skill:fabric-council`
- Oversized-context recursion: `/skill:fabric-rlm`
- Cross-model comparison: `/skill:fabric-fusion`
- Persistent advice or supervision: `/skill:fabric-advisor`, `/skill:fabric-supervisor`, or `/skill:fabric-ambient`
- Evidence-gated local mutation: `/skill:fabric-schema`

These recommendations are user-only advanced skills. Non-Fabric harnesses keep the generic mappings in the core skill.
