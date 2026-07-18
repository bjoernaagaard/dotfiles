# Click CLIs

Use Click's parameter types and command model at the adapter boundary. Keep domain behavior callable without Click so it can be tested independently.

`click.echo` is recommended for Click-owned output because it uses Click's Unicode-aware streams and can target stderr with `err=True`; `print` remains valid Python and may be appropriate in non-Click layers. Use `click.style` or `click.secho` for terminal styling; Click strips ANSI styling when color is disabled or the stream isn't a terminal.

Validate syntax and path shape with Click types:

```python
@click.argument("input_file", type=click.Path(exists=True, dir_okay=False, path_type=Path))
@click.option("--format", "format_", type=click.Choice(["json", "csv"]))
def convert(input_file: Path, format_: str) -> None:
    ...
```

A missing output path may be valid when the command creates it. Domain-level permissions and semantic validation remain outside Click.

Raise `click.UsageError` for invocation mistakes and `click.ClickException` or an owned subclass for user-facing command failures. `raise SystemExit(code) from exc` retains exception chaining in Python, but Click's normal standalone runner converts exits to CLI behavior and doesn't promise to display the chained traceback. Use standalone-mode controls only when embedding or testing requires them.

Use groups and `ctx.ensure_object` for shared command context. Prompts require an interactive terminal; support noninteractive options for automation. Don't add unconditional stderr flushes unless a reproducible buffering boundary requires one.

Test with `click.testing.CliRunner`: arguments, stdout, stderr where supported, exit code, exception, prompts, environment, and filesystem isolation.
