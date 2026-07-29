# Background jobs

Move work out of request handling when it exceeds the response budget, needs independent retries, or should survive process restarts. Small in-process tasks are suitable only when loss on process exit is acceptable.

## Contract

Persist a job identity and state when callers need status: `pending`, `running`, and a terminal state such as `succeeded`, `failed`, or `cancelled`. State transitions should be atomic and timestamped. Return a job ID and status location from asynchronous APIs.

Queue delivery semantics depend on the broker and acknowledgement configuration. Design workers for duplicate delivery unless exactly-once effects are proven end to end. Idempotency techniques include provider-supported keys, unique constraints, transactional outboxes, upserts, and compare-and-set state transitions. A check followed by an external side effect isn't atomic by itself.

Retry transient failures with the resilience policy. Permanent failures go to a terminal state and, when operationally useful, a dead-letter path carrying safe diagnostics. Set soft and hard execution limits according to the worker platform and ensure interrupted work can resume or restart safely.

For Celery, broker visibility, late acknowledgements, worker loss behavior, and prefetch affect duplicate work and throughput; verify configuration against the deployed broker and Celery version rather than copying a universal block.

Expose queue depth, oldest-job age, processing latency, retries, terminal failures, and worker health. Test duplicate delivery, crash after side effect, crash before acknowledgement, poison jobs, cancellation, and state races.
