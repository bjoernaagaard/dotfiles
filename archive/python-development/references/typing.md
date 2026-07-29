# Type safety

Preserve the repository's type checker and strictness. This pack supports ty and Pyrefly; don't add a second checker without a migration reason.

## Annotations

Annotate public boundaries and code where annotations catch meaningful mistakes. Use built-in generics and `X | None` when the minimum Python version supports them. Narrow unions with explicit guards. Minimize `Any` at owned boundaries; it remains appropriate when an interface is genuinely dynamic or untyped.

Use `Protocol` for structural interfaces consumed by code. Use ABCs when shared runtime behavior, registration, or enforced inheritance is required. Use generics when an input-output type relationship must be preserved, not merely to remove duplication.

`typing.cast()` informs static analysis and performs no runtime validation. `Literal` is suitable when values come from a closed programmatic set; validate external strings before narrowing them. Publish `py.typed` for distributions supplying inline annotations.

## Checker commands

```bash
uv run ty check
uv run pyrefly check
```

Detect configuration in `pyproject.toml`, `pyrefly.toml`, dependencies, and CI. Apply suppressions at the narrowest expression with a rule code and reason. Roll strictness out incrementally in existing projects rather than hiding errors globally.

PEP 695 syntax requires Python 3.12. Runtime availability and checker support are separate; verify new typing features with the project's pinned checker.
