# Structure and public APIs

Group code by concepts that change together. Prefer the repository's established package topology; introduce depth or layers only when they clarify a real boundary.

## Modules

- Give each module one coherent purpose. File length is a heuristic, not a split criterion.
- Use leading underscores for internal names.
- Define `__all__` when a module intentionally publishes or re-exports a controlled API; Python doesn't require it in every module.
- Keep package `__init__.py` small. Avoid I/O, environment reads, network calls, and expensive object creation during import.
- Defer optional dependencies until their feature is used when eager import would make the base package unusable.

## Imports

Use the repository's style. Absolute imports are clear across package boundaries; explicit relative imports are valid and often stable within a package. Avoid wildcard imports outside deliberate re-export modules. Resolve import cycles by moving shared concepts or reversing dependencies rather than by scattering inline imports.

## Organization choices

- Technical layers (`api`, `services`, `repositories`) fit smaller applications with clear dependency direction.
- Domain packages fit larger systems where each business area owns models, services, persistence, and adapters.
- A `src/` layout is recommended for distributable packages; it isn't a Python requirement.
- Parallel `tests/` trees are conventional for packages. Colocation is valid when repository tooling excludes tests from distribution.

Dependencies should point from delivery mechanisms toward domain behavior and from domain behavior toward explicit ports, not from business logic back into HTTP or CLI adapters.

Completion criterion: every public import is intentional, imports have no surprising side effects, and dependency direction can be stated without cycles.
