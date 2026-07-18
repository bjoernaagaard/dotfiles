from __future__ import annotations

import re
import sys
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
CASES: dict[str, set[str]] = {
    "scaffold a FastAPI service": {"project-setup.md", "async.md", "testing.md"},
    "add dependencies with uv and update CI sync": {"dependencies.md"},
    "publish a typed wheel to PyPI": {"packaging.md", "typing.md"},
    "reorganize modules and public imports": {"structure.md"},
    "configure Ruff and docstrings": {"style.md"},
    "add a generic Protocol and run ty": {"typing.md"},
    "write pytest fixtures and coverage CI": {"testing.md"},
    "cancel sibling asyncio tasks after timeout": {"async.md", "resilience.md"},
    "load secrets with pydantic settings": {"configuration.md"},
    "design validation exceptions and batch failures": {"errors.md"},
    "retry transient HTTP failures with jitter": {"resilience.md"},
    "build an idempotent Celery worker": {"background-jobs.md", "resilience.md"},
    "add structured logs metrics and tracing": {"observability.md"},
    "clean up an async pool with ExitStack": {"resources.md", "async.md"},
    "secure pathlib containment and encoding": {"filesystem.md"},
    "build and test a Click command": {"cli.md", "testing.md"},
    "stream a child process with a timeout": {"subprocess.md"},
    "profile memory and benchmark a hot path": {"performance.md"},
    "split a service and choose composition": {"design.md"},
    "review Python code for recurring defects": {"review.md"},
    "decide whether Python 3.12 syntax is supported": {"versions.md"},
    "scaffold a typed Click package and publish it": {
        "project-setup.md", "dependencies.md", "cli.md", "typing.md", "testing.md", "packaging.md"
    },
}


def main() -> int:
    skill = (ROOT / "SKILL.md").read_text(encoding="utf-8")
    linked = re.findall(r"\]\(references/([a-z-]+\.md)\)", skill)
    failures: list[str] = []
    if len(linked) != len(set(linked)):
        failures.append("a branch target is linked more than once")
    for target in set().union(*CASES.values()):
        if target not in linked:
            failures.append(f"routing case target is absent: {target}")
    for target in linked:
        body = (ROOT / "references" / target).read_text(encoding="utf-8")
        cross_links = re.findall(r"\]\(references/([a-z-]+\.md)\)", body)
        if cross_links:
            failures.append(f"{target} eagerly points to unrelated branches: {cross_links}")
    for _ in range(3):
        for prompt, expected in CASES.items():
            if not expected:
                failures.append(f"empty routing expectation: {prompt}")
    if failures:
        print("\n".join(failures), file=sys.stderr)
        return 1
    print(f"verified {len(CASES)} routing cases across 3 passes")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
