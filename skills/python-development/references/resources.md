# Resource management

Acquire and release files, sockets, locks, transactions, pools, temporary objects, and subprocesses through context managers when their lifetime is lexical.

A context manager calls `__exit__` only after `__enter__` returns successfully. If acquisition performs multiple steps, clean up partial acquisition inside `__enter__` or use `ExitStack`.

```python
from contextlib import contextmanager

@contextmanager
def managed_resource():
    resource = acquire()
    try:
        yield resource
    finally:
        resource.close()
```

Return a truthy value from `__exit__` only when suppressing the active exception is intentional and documented. Generator context managers need `try/finally`; transaction managers usually need explicit commit/rollback behavior.

Use `AsyncExitStack` and `@asynccontextmanager` for asynchronous resources. Cancellation can interrupt awaited cleanup, so follow the resource library's shutdown contract and test cancellation paths.

Keep long-lived pools and clients at application lifecycle scope, not per request. A component may expose manual `close()` plus context-manager support when both lifetimes are genuine; implementing both isn't mandatory for every resource.

For streaming, retain resources until iteration completes or the consumer disconnects. Accumulate chunks only when the final result must fit in memory; otherwise stream incrementally. Track time to first byte, total duration, bytes, cancellation, and cleanup. Test normal exit, body failure, acquisition failure, cleanup failure, and nested resources.
