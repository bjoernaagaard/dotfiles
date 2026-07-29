# Verification sources

Verified 2026-07-13. Repository policy and explicitly labeled heuristics/recommendations are excluded; this ledger tracks retained volatile facts.

| Claim ID | Owner | Authority | Verified version | Probe |
|---|---|---|---|---|
| UV-001 | dependencies.md | https://docs.astral.sh/uv/reference/cli/ | uv 0.11.28 | `verify_uv.py` |
| UV-002 | dependencies.md | https://docs.astral.sh/uv/concepts/projects/sync/ | uv 0.11.28 | `verify_uv.py` |
| UV-003 | packaging.md | https://docs.astral.sh/uv/guides/package/ | uv 0.11.28 | `verify_uv.py` |
| PY-001 | filesystem.md | https://docs.python.org/3/library/pathlib.html | Python 3.10–3.13 | `verify_stdlib.py` |
| PY-002 | subprocess.md | https://docs.python.org/3/library/subprocess.html | Python 3.10–3.13 | `verify_stdlib.py` |
| PY-003 | resources.md | https://docs.python.org/3/reference/datamodel.html#with-statement-context-managers | Python 3.10–3.13 | `verify_stdlib.py` |
| PY-004 | versions.md | linked PEPs and https://docs.python.org/3/whatsnew/ | Python 3.10–3.13 | `verify_stdlib.py` |
| CLICK-001 | cli.md | https://click.palletsprojects.com/en/stable/utils/ | Click 8.4 docs | documentation |
| CLICK-002 | cli.md | https://click.palletsprojects.com/en/stable/exceptions/ | Click 8.4 docs | documentation |
| PACK-001 | packaging.md | https://packaging.python.org/en/latest/specifications/pyproject-toml/ | current spec | documentation |
| PACK-002 | packaging.md | https://packaging.python.org/en/latest/specifications/declaring-project-metadata/ | current spec | documentation |
| TYPE-001 | typing.md | https://docs.astral.sh/ty/ and https://pyrefly.org/en/docs/ | current CLIs | installed project checks |
| PYTEST-001 | testing.md | https://docs.pytest.org/en/stable/reference/ | current docs | documentation |
| PYD-001 | configuration.md | https://docs.pydantic.dev/latest/concepts/pydantic_settings/ | Pydantic Settings 2 | documentation |
| CELERY-001 | background-jobs.md | https://docs.celeryq.dev/en/stable/userguide/tasks.html | Celery 5.x docs | documentation |
| TENACITY-001 | resilience.md | https://tenacity.readthedocs.io/en/latest/ | current docs | documentation |
| STRUCTLOG-001 | observability.md | https://www.structlog.org/en/stable/ | current docs | documentation |

## Rejected or rewritten claims

- `uv lock --no-install`: unsupported in uv 0.11.28; removed.
- `uv pip freeze --require-hashes`: unsupported in uv 0.11.28; replaced with `uv export`.
- `uv --python 3.11 run ...`: invalid option placement; retained form is `uv run --python 3.11 ...` only where needed.
- stderr is universally unbuffered and must be flushed before Click confirmation: unsupported as a general rule; removed.
- `SystemExit` chaining guarantees displayed tracebacks under Click: false as a display guarantee; qualified.
- `__exit__` always runs: incomplete when `__enter__` fails; qualified.
- every module requires `__all__`, every file splits at 300–500 lines, 120 columns is a standard, and absolute imports are universally superior: rewritten as policy, heuristic, or contextual advice.
- “uv is 10–100x faster”: benchmark-dependent marketing claim; removed.
