# Subprocesses

Use `subprocess.run` for bounded commands and `Popen` when interaction or incremental streaming is required.

Pass an argument sequence so values aren't interpreted by a shell. Use `shell=True` only when shell language is the feature, build the command from trusted constants, and document the platform dependency.

Set `check=True` when nonzero exit is exceptional; set `check=False` when the caller interprets return codes. Use `capture_output=True` only when output must be retained; it can consume unbounded memory. `text=True` decodes through the selected/default encoding, so specify `encoding` and `errors` when the protocol defines them.

Set a timeout when the caller has a deadline. `subprocess.run(..., timeout=...)` terminates and waits for the child after timeout, but process creation itself may not be interruptible on every platform. Descendant process cleanup may require process groups or job objects.

```python
result = subprocess.run(
    ["uv", "run", "pytest", "-q"],
    check=True,
    capture_output=True,
    text=True,
    encoding="utf-8",
    timeout=300,
)
```

On `CalledProcessError`, record command identity, return code, and bounded sanitized output; avoid logging secrets in arguments or environment. For streaming with `Popen`, drain stdout and stderr without deadlock, wait for completion, inspect the return code, and terminate/kill on cancellation according to a bounded shutdown policy.

Test success, nonzero exit, timeout, large output, signal/cancellation, missing executable, encoding failure, and secret redaction.
