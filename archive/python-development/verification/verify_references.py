from __future__ import annotations

import re
import sys
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
RETIRED = {
    "uv-package-manager",
    "scaffolding-python-projects",
    "python-anti-patterns",
    "python-background-jobs",
    "python-cli",
    "python-code-style",
    "python-configuration",
    "python-design-patterns",
    "python-error-handling",
    "python-observability",
    "python-packaging",
    "python-pathlib",
    "python-performance-optimization",
    "python-project-structure",
    "python-resilience",
    "python-resource-management",
    "python-subprocess",
    "python-testing-patterns",
    "python-type-safety",
    "python-version-features",
    "async-python-patterns",
}
FORBIDDEN = ("uv lock --no-install", "uv pip freeze --require-hashes", "uv --python")


def main() -> int:
    failures: list[str] = []
    skill = ROOT / "SKILL.md"
    text = skill.read_text(encoding="utf-8")
    if not text.startswith("---\nname: python-development\ndescription:"):
        failures.append("invalid SKILL.md frontmatter")
    for path in ROOT.rglob("*.md"):
        body = path.read_text(encoding="utf-8")
        for target in re.findall(r"\[[^]]+\]\(([^)]+\.md)\)", body):
            if target.startswith(("http://", "https://")):
                continue
            if not (path.parent / target).resolve().exists():
                failures.append(f"{path.relative_to(ROOT)}: broken link {target}")
        for phrase in FORBIDDEN:
            if phrase in body and path.name != "SOURCES.md":
                failures.append(f"{path.relative_to(ROOT)}: forbidden phrase {phrase}")
    skill_root = ROOT.parent
    for name in RETIRED:
        if (skill_root / name).exists():
            failures.append(f"retired skill still exists: {name}")
    ids = re.findall(r"\| ([A-Z]+-\d+) \|", (ROOT / "verification/SOURCES.md").read_text(encoding="utf-8"))
    if len(ids) != len(set(ids)):
        failures.append("duplicate claim ID in SOURCES.md")
    if failures:
        print("\n".join(failures), file=sys.stderr)
        return 1
    print("reference integrity verified")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
