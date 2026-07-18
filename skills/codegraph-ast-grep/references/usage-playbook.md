# Usage playbook

Use **Map → Outline → Match** to narrow context before reading or changing source.

## Decision matrix

| Need | First choice | Follow-up |
| --- | --- | --- |
| Explain a subsystem or path | MCP `codegraph_explore` or CLI `codegraph explore` | outline returned candidate files |
| Find a symbol | `codegraph query <search>` | `codegraph node <symbol>` |
| Find direct callers or callees | `codegraph callers <symbol>` / `codegraph callees <symbol>` | outline related files |
| Estimate a symbol's blast radius | `codegraph impact <symbol>` | language-server references and focused tests |
| Find tests affected by changed files | `codegraph affected <files...>` | run the returned test targets |
| Inspect indexed files under a directory | `codegraph files --filter <dir>` | outline candidate files |
| Match indexed files by path glob | `codegraph files --pattern <glob>` | outline candidate files |
| Map one file or directory cheaply | `ast-grep outline <path>` | read only relevant ranges |
| Match one syntax shape | `ast-grep run` | validate a positive and negative example |
| Match relational or reusable rules | `ast-grep scan` | invoke the `ast-grep` skill |
| Rename or resolve exact symbols | language-server tooling | use CodeGraph for impact context |

## Map

The default MCP server exposes `codegraph_explore`. It returns relevant symbol source, call paths, and a blast-radius summary. The CLI equivalent is:

```text
codegraph explore "how does <entry> reach <behavior>?"
```

Use focused CLI commands when the desired output is narrower:

```text
codegraph query "Auth" --kind function
codegraph callers AuthService.login
codegraph callees AuthService.login
codegraph impact AuthService.login
codegraph files --filter apps/web
codegraph files --pattern "**/*auth*"
codegraph affected src/auth.ts --filter "e2e/**"
```

`--filter` on `codegraph files` is a directory prefix. `--pattern` is the path glob. `--filter` on `codegraph affected` is instead the test-file glob.

A CodeGraph result is static-analysis evidence, not proof that every dynamic edge exists. Follow its staleness banner after edits. Use a language server or compiler when exact symbol identity or type resolution determines correctness.

## Outline

Outline every candidate source file before reading implementation ranges:

```text
ast-grep outline <file>
ast-grep outline <directory>
```

Defaults adapt to input: a file shows local structure with member digests; a directory shows exported names. Common narrowing forms are:

```text
ast-grep outline <file> --items imports
ast-grep outline <file> --items exports
ast-grep outline <file> --match <regex> --view expanded
ast-grep outline <directory> --type class,function
ast-grep outline <path> --json=stream
```

`--match` filters top-level items, not members. `--type` filters top-level symbol types. `outline` resolves neither references nor types; its purpose is navigation. Invoke `ast-grep-outline` for the full navigation workflow and common flags. For custom extractors, consult `ast-grep outline --help` and the upstream outline sources.

## Match

After the outline reveals the target shape:

- Use `ast-grep run -p '<pattern>' -l <language> <path>` for a simple node pattern.
- Use `ast-grep scan --rule <rule.yml> <path>` for relational, composite, reusable, or project rules.
- Test the pattern against known positive and negative snippets before scanning broadly.
- Inspect a misparsed pattern with `ast-grep run -p '<pattern>' -l <language> --debug-query=cst`.

Invoke the `ast-grep` skill for metavariables, relational traversal, composite rules, strictness, constraints, transforms, or fixes. That skill is the single source of truth for rule syntax.

## Rewrite and validation

1. Run a match-only scan and review every match class.
2. Use an interactive rewrite or a normal reviewed patch for the requested change.
3. Re-run the match to detect missed or remaining shapes.
4. Use language-server references for exported or shared symbols.
5. Run the smallest typecheck, lint, test, or build command that covers the changed behavior.

Completion requires all candidate files to have an outline or a recorded fallback, all intended matches to be accounted for, and the requested behavior to pass focused project validation.

## Primary sources

- CodeGraph CLI: <https://colbymchenry.github.io/codegraph/reference/cli/>
- CodeGraph MCP server: <https://colbymchenry.github.io/codegraph/reference/mcp-server/>
- CodeGraph indexing: <https://colbymchenry.github.io/codegraph/guides/indexing/>
- ast-grep CLI: <https://astgrep.com/reference/cli.html>
- ast-grep pattern syntax: <https://astgrep.com/guide/pattern-syntax.html>
- ast-grep relational rules: <https://astgrep.com/guide/rule-config/relational-rule.html>
- ast-grep outline implementation: <https://github.com/ast-grep/ast-grep/tree/main/crates/outline>
