# Dependencies and uv

Use the repository's pinned uv version and existing dependency model. For new projects, commit `pyproject.toml` and `uv.lock`; put development tools in `[dependency-groups]`, normally `dev`.

## Commands

```bash
uv init --package app-name       # packaged application
uv init --lib library-name       # library
uv python pin 3.12
uv add httpx
uv add --group dev pytest ruff ty
uv add --optional docs sphinx
uv remove httpx
uv remove --group dev pytest
uv lock
uv lock --upgrade
uv lock --upgrade-package httpx
uv sync
uv sync --locked                 # fail if lockfile needs changes
uv sync --frozen                 # use lockfile without checking project metadata
uv run pytest
uv tree
uv tree --outdated
uv python install 3.12
uv python list
uv venv --python 3.12
```

`uv run` discovers the project environment and normally locks and syncs before executing. Use `--locked` in CI when drift must fail and `--frozen` only when intentionally skipping freshness checks. Use `uv pip` for pip-compatible, environment-level workflows; use project commands for managed projects.

## Sources and migration

- Import requirement files with `uv add -r requirements.txt` when their entries belong in project metadata.
- Export project resolution with `uv export --format requirements-txt`; don't use `uv pip freeze` as a project lock export.
- Declare Git, URL, workspace, and local sources under `[tool.uv.sources]` when they are uv-specific.
- Keep runtime dependencies in `[project.dependencies]`, development dependencies in `[dependency-groups]`, and installable feature extras in `[project.optional-dependencies]`.

## CI and containers

Cache uv's cache directory when useful, but treat `uv.lock` as the reproducibility boundary. Install from copied metadata before copying frequently changing source files to improve container layer reuse. Verify with `uv sync --locked` followed by the repository's checks.
