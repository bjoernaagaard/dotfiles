# Project setup

This is a sequence for greenfield repositories. Extend an existing repository through its current structure rather than re-scaffolding it.

## Baseline

1. Choose the supported Python range from deployment constraints; use 3.12+ only when no older target is required.
2. Initialize with uv and choose one installable package name.
3. Add runtime dependencies, then a `dev` dependency group containing the selected formatter, type checker, and tests.
4. Create `src/<package>/`, `tests/`, README, and tool configuration.
5. Add `.env.example` only when runtime configuration exists. Commit examples, not secrets.
6. Run sync, lint, type checks, tests, and a package build when the project is distributable.

## Archetypes

### CLI

Use `uv init --package`, a `src/` package, a Click entry function, and `[project.scripts]`. Test through `click.testing.CliRunner`.

### Library

Use `uv init --lib`, define a narrow public API, include `py.typed` when distributing inline annotations, build both wheel and sdist, and test the built artifact.

### FastAPI

Separate HTTP schemas and handlers from business logic. Add FastAPI, an ASGI server, Pydantic settings when needed, HTTPX, pytest, and async-test support. Configure CORS from explicit deployment origins when credentials are allowed. Test through HTTPX `ASGITransport`.

### Django

Initialize the uv project, add Django and test tooling, run `django-admin startproject`, keep settings environment-aware, and use Django's migration and deployment checks. Keep framework conventions unless the domain complexity justifies additional layers.

## Shared files

Ignore `.venv/`, bytecode, and tool caches. Decide as repository policy whether `.python-version` is committed; uv commonly creates it to pin local Python selection. Document `uv sync` and `uv run` commands in README.

Completion criterion: a fresh checkout can sync and pass lint, type, test, and build checks using only documented commands.
