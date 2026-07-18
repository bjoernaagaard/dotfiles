# Errors and validation

Validate untrusted input at system boundaries and convert it to domain types before core logic. Choose EAFP when attempting the operation is authoritative; use explicit validation when it produces a clearer contract or prevents an expensive/unsafe operation.

## Exceptions

Use the most specific existing exception that expresses the contract. Define a small domain hierarchy when callers need to distinguish owned failures. Exception messages identify what failed and relevant safe context; remediation belongs there only when known.

Translate exceptions at architectural boundaries and preserve causes:

```python
try:
    record = repository.load(identifier)
except StorageError as exc:
    raise UserLookupError(identifier) from exc
```

Use `raise ... from None` only when the lower-level context is deliberately irrelevant to users and retained elsewhere for diagnosis. Catch `Exception` at a process, request, task, or batch boundary where failure policy is explicit; re-raise cancellation and termination signals naturally because they derive from `BaseException` rather than `Exception`.

## Partial failure

Batch behavior is a product decision. Fail atomically when partial completion would violate invariants. Otherwise return successes and structured per-item failures, preserving stable item identities and making retry semantics clear.

Parsers should parse rather than duplicate incomplete pre-checks. Pydantic is useful for structured external data but doesn't replace domain invariants. Test exception type, stable message fields, cause chaining, atomicity, and partial-result ordering.
