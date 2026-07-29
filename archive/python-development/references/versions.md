# Python 3.10–3.13 features

Runtime availability and static-checker support are separate. Check the project's minimum Python and pinned checker before adopting syntax.

| Feature | First version | Authority |
|---|---:|---|
| `X | Y` unions | 3.10 | PEP 604 |
| Built-in collection generics | 3.9; available throughout this matrix | PEP 585 |
| Structural pattern matching | 3.10 | PEP 634 |
| `Path.is_relative_to()` | 3.9; available throughout this matrix | Python pathlib docs |
| `asyncio.TaskGroup`, `asyncio.timeout()` | 3.11 | Python asyncio docs |
| `ExceptionGroup`, `except*` | 3.11 | PEP 654 |
| `typing.Self` | 3.11 | PEP 673 |
| `TypeVarTuple` | 3.11 | PEP 646 |
| `tomllib` | 3.11 | Python tomllib docs |
| PEP 695 type-parameter syntax | 3.12 | PEP 695 |
| PEP 701 f-string grammar | 3.12 | PEP 701 |
| `Unpack[TypedDict]` for `**kwargs` | 3.12 | PEP 692 |
| `typing.override` | 3.12 | PEP 698 |
| Comprehension inlining | 3.12 | PEP 709 |
| Supported `pathlib.Path` subclassing | 3.12 | Python pathlib docs |
| `typing.ReadOnly` | 3.13 | PEP 705 |
| `warnings.deprecated` | 3.13 | PEP 702, Python warnings docs |
| Type variable defaults | 3.13 | PEP 696 |
| `dbm.sqlite3` | 3.13 | Python dbm docs |
| Experimental free-threaded build | 3.13 | PEP 703 |

## Adoption

- With minimum 3.10, use modern unions, built-in generics, and matching where it clarifies data-shape branching.
- With minimum 3.11, use `TaskGroup` for one structured operation, `asyncio.timeout` for deadlines, and `tomllib` for TOML reads.
- With minimum 3.12, PEP 695 syntax is available, but adopt it only when the project's checker and style support it.
- With minimum 3.13, `ReadOnly`, type-variable defaults, and `warnings.deprecated` are available. Free-threaded Python remains an explicit build choice whose extension compatibility and workload benefit must be measured.

Version bumps require CI coverage, dependency compatibility, deployment availability, and release-policy review. Avoid mass syntax rewrites unless they provide a concrete maintenance benefit.
