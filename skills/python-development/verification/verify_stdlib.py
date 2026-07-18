from __future__ import annotations

import subprocess
import sys


PROBES = {
    "3.10": """
from pathlib import Path
assert Path('missing').resolve().is_absolute()
assert Path('/a/b').is_relative_to(Path('/a'))
assert not Path('/a').is_relative_to(Path('/b'))
compile('x: int | str = 1', '<probe>', 'exec')
""",
    "3.11": """
import asyncio, tomllib
assert hasattr(asyncio, 'TaskGroup') and hasattr(asyncio, 'timeout')
compile('try:\\n raise ExceptionGroup(\"x\", [ValueError()])\\nexcept* ValueError:\\n pass', '<probe>', 'exec')
""",
    "3.12": """
from typing import override
compile('def first[T](items: list[T]) -> T:\\n return items[0]', '<probe>', 'exec')
""",
    "3.13": """
import dbm.sqlite3
from typing import ReadOnly
from warnings import deprecated
assert ReadOnly and deprecated and dbm.sqlite3
""",
}


def main() -> int:
    failures: list[str] = []
    for version, probe in PROBES.items():
        completed = subprocess.run(
            ["uv", "run", "--no-project", "--python", version, "python", "-c", probe],
            capture_output=True,
            text=True,
            timeout=120,
        )
        if completed.returncode:
            failures.append(f"Python {version}: {completed.stderr.strip()}")
        else:
            print(f"verified Python {version}")
    if failures:
        print("\n".join(failures), file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
