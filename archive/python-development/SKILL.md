---
name: python-development
description: Develop and review Python projects. Use for project setup, dependencies, packaging, structure, style, typing, testing, async code, configuration, errors, resilience, background jobs, observability, resources, filesystems, CLIs, subprocesses, performance, design, reviews, or version compatibility.
---

# Python development

Follow the repository's existing Python version, package manager, formatter, type checker, test runner, and architecture. Treat repository instructions and configuration as policy; preserve established choices unless the task changes them.

## Process

1. Inspect `pyproject.toml`, lockfiles, CI, and nearby code to identify project policy.
2. Select every branch that materially affects the task from the table below.
3. Read only those references completely. Mixed tasks may require several references; unrelated branches remain unloaded.
4. Implement against the repository's conventions. When no convention exists, use the reference recommendation and label consequential choices as recommendations rather than Python requirements.
5. Run the project's narrow checks during development and its relevant final checks once the change is complete.

Completion criterion: every changed behavior is covered by all applicable branches, every command matches the installed tool, and the relevant lint, type, test, and build checks pass or their exact blockers are reported.

## Branches

| When the task involves | Read completely |
|---|---|
| A greenfield application, library, CLI, FastAPI, or Django scaffold | [`references/project-setup.md`](references/project-setup.md) |
| uv, environments, Python installation, dependency groups, lockfiles, sync, or CI installation | [`references/dependencies.md`](references/dependencies.md) |
| Build metadata, wheels, sdists, entry points, PyPI, or publishing | [`references/packaging.md`](references/packaging.md) |
| Packages, modules, imports, `__all__`, layouts, or layer boundaries | [`references/structure.md`](references/structure.md) |
| Ruff, formatting, naming, docstrings, or documentation conventions | [`references/style.md`](references/style.md) |
| Annotations, generics, protocols, narrowing, ty, or Pyrefly | [`references/typing.md`](references/typing.md) |
| pytest, fixtures, mocks, property tests, coverage, or test CI | [`references/testing.md`](references/testing.md) |
| asyncio, `TaskGroup`, cancellation, async HTTP, or blocking in async code | [`references/async.md`](references/async.md) |
| Environment variables, settings, secrets, or environment-specific behavior | [`references/configuration.md`](references/configuration.md) |
| Validation, exception design, chaining, API boundaries, or partial failure | [`references/errors.md`](references/errors.md) |
| Retries, backoff, jitter, deadlines, circuit breakers, or transient failure | [`references/resilience.md`](references/resilience.md) |
| Queues, workers, job state, Celery, idempotency, or delivery semantics | [`references/background-jobs.md`](references/background-jobs.md) |
| Logs, metrics, traces, correlation, cardinality, or alerts | [`references/observability.md`](references/observability.md) |
| Context managers, cleanup, pools, streaming, or `ExitStack` | [`references/resources.md`](references/resources.md) |
| `pathlib`, path containment, path resolution, or text encoding | [`references/filesystem.md`](references/filesystem.md) |
| Click commands, options, streams, prompts, progress, or CLI tests | [`references/cli.md`](references/cli.md) |
| External processes, command safety, timeouts, capture, or streaming | [`references/subprocess.md`](references/subprocess.md) |
| Profiling, benchmarking, memory, hot paths, caching, or optimization | [`references/performance.md`](references/performance.md) |
| Service boundaries, SRP, composition, abstraction, or layering | [`references/design.md`](references/design.md) |
| Reviewing Python for recurring defects and maintainability risks | [`references/review.md`](references/review.md) |
| Minimum-version support or Python 3.10–3.13 feature availability | [`references/versions.md`](references/versions.md) |

## Authority

- **Fact**: Python documentation, accepted PEPs, official tool documentation, installed CLI help, or an executable probe.
- **Policy**: repository instructions or checked-in configuration.
- **Heuristic**: a review aid whose usefulness depends on context.
- **Recommendation**: a default for an undecided project, subject to local constraints.

Volatile factual claims and probes are indexed in [`verification/SOURCES.md`](verification/SOURCES.md).
