# Filesystem paths

Prefer `pathlib.Path` in owned modern code while interoperating with libraries that accept `os.PathLike`. Existing `os.path` code needn't be rewritten without a task benefit.

`Path.resolve(strict=False)` is the default on supported Python versions and may return an absolute resolved path for a target that doesn't exist. Use `strict=True` when every path component must exist. `Path.is_relative_to()` returns a boolean; `Path.relative_to()` raises `ValueError` when the relationship doesn't hold.

Lexical containment and resolved filesystem containment differ. For security boundaries, resolve the trusted base and candidate, account for symlinks and race conditions, then use `candidate.is_relative_to(base)`. This check alone doesn't prevent a path from being replaced between validation and use.

Pass `encoding="utf-8"` for project text formats whose encoding is UTF-8. Omitting encoding uses platform-dependent defaults on Python 3.10–3.13; Python 3.15 changes UTF-8 mode defaults but explicit formats remain clearer. Read TOML in binary mode for `tomllib`.

Use `/` for composition and `name`, `stem`, `suffix`, `parent`, `with_name`, and `with_suffix` for components. Use `mkdir(parents=True, exist_ok=True)` only when existing directories are acceptable. Handle `FileNotFoundError`, `PermissionError`, and `OSError` at the boundary that owns recovery.

Test missing paths, symlinks, Unicode names, Windows separators when supported, permission failures, and cleanup through `tmp_path`.
