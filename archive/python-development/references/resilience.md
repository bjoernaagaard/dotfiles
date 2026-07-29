# Resilience

Start with a deadline. Retry only operations that are safe to repeat and failures likely to become successful without changing the request.

## Retry policy

- Classify retryable exceptions and responses explicitly; HTTP 429 and selected 5xx responses may be transient, while most 4xx responses are not.
- Use exponential backoff with jitter to reduce synchronized retries.
- Bound attempts and elapsed time inside the caller's deadline.
- Honor server retry guidance such as `Retry-After` when applicable.
- Put retries at one owned layer so client, worker, proxy, and application retries don't multiply unexpectedly.
- Log retry reason and attempt with bounded fields; measure retry rate and final outcomes.

Tenacity is a recommendation when policy is nontrivial. Configure `reraise=True` when callers should receive the final underlying exception rather than `RetryError`.

Timeouts need connect/read/write/pool distinctions when the client supports them. A per-attempt timeout doesn't bound a multi-attempt operation; combine it with an overall deadline.

Circuit breakers can reduce pressure on a failing dependency, but add state and recovery complexity. Add one only with measurable failure thresholds, half-open probes, metrics, and tests.

Fallbacks must be semantically safe. Cached or default data should identify staleness where users could otherwise mistake it for current truth. Test retryable and permanent failures, maximum attempts, elapsed budget, jitter with deterministic randomness, idempotency, cancellation, and metrics.
