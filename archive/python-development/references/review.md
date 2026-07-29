# Python review

Apply this checklist to changed code and its direct boundaries. Report evidence and impact rather than enforcing every item mechanically.

## Correctness and failure

- Inputs become validated domain types at the boundary.
- Exceptions are specific, translated at the owning boundary, and preserve useful causes.
- Batch atomicity or partial-failure semantics match the contract.
- Cleanup covers success, failure, cancellation, and partial acquisition.
- Async paths contain no blocking I/O and preserve cancellation.

## External effects

- Network and subprocess work has a caller-owned deadline.
- Retries are bounded, target transient failures, and don't multiply across layers.
- Repeated jobs and side effects are idempotent where delivery can duplicate.
- Configuration and secrets come from documented deployment inputs and aren't logged.
- Commands use argument sequences unless shell syntax is deliberately required.

## Design and types

- Domain behavior isn't entangled with transport or persistence without a reason.
- Public interfaces don't unintentionally expose vendor or ORM types.
- Annotations preserve useful relationships and avoid unjustified `Any`.
- New abstractions represent stable concepts; duplication isn't removed speculatively.
- Imports avoid surprising side effects and cycles.

## Tests and operations

- Tests cover meaningful success, boundary, error, and cleanup paths.
- Mocks sit at external boundaries rather than mirroring implementation calls.
- Structured logs exclude secrets and metrics use bounded labels.
- Performance changes include representative measurement.

Completion criterion: every applicable check is either satisfied, reported with `file:line` evidence, or explicitly dismissed with a context-specific reason.
