# Style and documentation

Repository configuration is the authority. For an undecided modern project, Ruff is a recommended formatter and linter because it combines formatting, import sorting, Pyflakes, pycodestyle, and many plugin rule sets.

```toml
[tool.ruff]
target-version = "py312"
line-length = 100

[tool.ruff.lint]
select = ["E", "F", "I", "B", "C4", "UP", "SIM"]

[tool.ruff.format]
quote-style = "double"
```

Line length, quote style, docstring convention, and enabled rules are policies. Preserve existing values. Run `uv run ruff check --fix .` only when automatic fixes are in scope, then `uv run ruff format .`; use check-only forms in CI.

## Names

Follow PEP 8 unless local conventions differ: modules, functions, and variables use `snake_case`; classes use `CapWords`; constants use uppercase with underscores. Preserve conventional acronym casing used by the project rather than imposing all-uppercase acronyms.

## Documentation

Document public behavior whose contract isn't obvious. State inputs, output, side effects, and meaningful failures without repeating type annotations or implementation. Choose one docstring style when tooling requires it. Examples should be executable when they carry behavioral promises.

Comments explain constraints and reasons that code cannot express. Keep README commands synchronized with project tooling. Treat “document every public function” as a project policy, not a universal Python requirement.
