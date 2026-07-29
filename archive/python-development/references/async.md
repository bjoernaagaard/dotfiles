# Async Python

Use async code for concurrent waiting, not as a blanket replacement for synchronous code. Keep blocking calls off the event loop.

## Structured concurrency

On Python 3.11+, prefer `asyncio.TaskGroup` when sibling tasks form one operation: the first non-cancellation failure cancels remaining tasks and failures leave the group as an exception group. Use `asyncio.gather` when its ordered result and independent-failure semantics are specifically required.

```python
async with asyncio.TaskGroup() as group:
    first = group.create_task(fetch_first())
    second = group.create_task(fetch_second())
result = first.result(), second.result()
```

Use `asyncio.timeout()` on Python 3.11+ for an operation deadline. Cancellation is control flow: perform cleanup in `finally` or async context managers, then re-raise `CancelledError` unless deliberately translating it at a boundary.

## I/O and lifecycle

Use async-native database and HTTP clients inside async functions. Reuse clients and pools across requests through application lifecycle hooks; don't create a new HTTP client per call. Move unavoidable blocking I/O with `asyncio.to_thread` when thread safety permits. CPU-bound work belongs in a process, native implementation, or job worker when it would stall the event loop.

Bound concurrency with semaphores or worker pools. Give external operations timeouts and propagate an overall deadline so nested retries cannot exceed the caller's budget.

Test cancellation, timeout, partial completion, and cleanup. Enable asyncio debug diagnostics when investigating leaked tasks or event-loop blocking.
