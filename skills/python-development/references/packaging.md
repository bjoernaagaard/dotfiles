# Packaging

Use `pyproject.toml` metadata defined by PEP 621 with a PEP 517 build backend. Preserve the repository's backend; for a new pure-Python package, Hatchling, Flit, and setuptools are valid choices.

## Distribution layout

A `src/` layout is recommended for installable libraries because tests cannot accidentally import an uninstalled working tree. A flat layout remains valid for small projects. Package discovery configuration belongs to the chosen backend.

```toml
[build-system]
requires = ["hatchling"]
build-backend = "hatchling.build"

[project]
name = "example-package"
version = "0.1.0"
requires-python = ">=3.12"
readme = "README.md"
license = "MIT"
dependencies = []

[project.scripts]
example = "example_package.cli:main"
```

Use SPDX license expressions supported by the selected metadata version/backend. Keep development tools in `[dependency-groups]`; extras represent optional features exposed to package consumers.

## Typed packages

For a package distributing inline type information, include a `py.typed` marker as specified by PEP 561 and confirm it is present in the wheel.

## Build and publish

```bash
uv build
uv publish --publish-url https://test.pypi.org/legacy/
uv publish
```

Prefer trusted publishing in CI over long-lived API tokens. Test on TestPyPI when repository policy requires it. Before release, inspect wheel and sdist contents, install the wheel in a clean environment, import the package, run CLI smoke tests, and verify metadata.

Namespace packages, dynamic versions, compiled extensions, and multi-package workspaces require backend-specific official documentation; don't infer configuration across backends.
