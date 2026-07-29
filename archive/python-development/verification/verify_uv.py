from __future__ import annotations

import subprocess
import sys


COMMANDS: dict[tuple[str, ...], tuple[str, ...]] = {
    ("init",): ("--package", "--lib"),
    ("python", "pin"): (),
    ("python", "install"): (),
    ("python", "list"): (),
    ("add",): ("--group", "--optional"),
    ("remove",): ("--group",),
    ("lock",): ("--upgrade", "--upgrade-package"),
    ("sync",): ("--locked", "--frozen"),
    ("run",): (),
    ("tree",): ("--outdated",),
    ("venv",): ("--python",),
    ("export",): ("--format",),
    ("build",): (),
    ("publish",): ("--publish-url",),
}

FORBIDDEN = ("--no-install", "--require-hashes")


def help_text(command: tuple[str, ...]) -> str:
    completed = subprocess.run(
        ["uv", *command, "--help"],
        check=True,
        capture_output=True,
        text=True,
        timeout=30,
    )
    return completed.stdout + completed.stderr


def main() -> int:
    version = subprocess.run(
        ["uv", "--version"], check=True, capture_output=True, text=True, timeout=10
    ).stdout.strip()
    failures: list[str] = []
    for command, options in COMMANDS.items():
        try:
            output = help_text(command)
        except (OSError, subprocess.SubprocessError) as exc:
            failures.append(f"{' '.join(command)}: {exc}")
            continue
        for option in options:
            if option not in output:
                failures.append(f"{' '.join(command)}: missing {option}")
    lock_help = help_text(("lock",))
    freeze_help = help_text(("pip", "freeze"))
    if FORBIDDEN[0] in lock_help:
        failures.append("retired assumption changed: uv lock now exposes --no-install")
    if FORBIDDEN[1] in freeze_help:
        failures.append("retired assumption changed: uv pip freeze now exposes --require-hashes")
    if failures:
        print("\n".join(failures), file=sys.stderr)
        return 1
    print(f"verified {version}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
