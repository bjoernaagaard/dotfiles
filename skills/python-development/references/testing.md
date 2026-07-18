# Testing

Use pytest and the repository's test taxonomy. Tests should demonstrate behavior, isolate owned state, and clean up resources they create.

## Shape

- Arrange, act, and assert clearly; comments are optional when the phases are obvious.
- Name tests after behavior and outcome.
- Parameterize equivalent cases rather than duplicating bodies.
- Put broadly reusable fixtures in the nearest suitable `conftest.py`; keep specialized fixtures local.
- Prefer real domain objects and fakes. Mock external boundaries or expensive nondeterministic collaborators, not every internal call.
- Test success, boundary values, expected failures, cleanup, and idempotency where applicable.

Use `tmp_path` for files, `monkeypatch` for scoped environment changes, `caplog` for logging, and `CliRunner` for Click. Use `pytest.raises(..., match=...)` when the message is part of the contract.

For async tests, follow `async.md` and the installed async plugin's fixture mode. For time-dependent behavior, inject a clock when practical; a time-freezing library is acceptable for integration-heavy legacy code.

## Coverage and CI

Coverage locates untested paths; a percentage isn't proof of useful tests. Set thresholds as repository policy. Separate slow, integration, and end-to-end tests with registered markers when CI schedules differ.

```bash
uv run pytest
uv run pytest --cov=package --cov-report=term-missing
```

Property-based tests are recommended for parsers, serializers, algebraic invariants, and broad input spaces. Database integration tests should use isolated transactions or disposable databases and verify rollback paths.
