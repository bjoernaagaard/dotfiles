---
name: codegraph-ast-grep
description: Map, outline, and match code when setting up CodeGraph; tracing cross-file architecture, call paths, or impact; or planning structural searches and refactors with ast-grep.
---

# CodeGraph + ast-grep

Use three complementary views in a fixed sequence:

| Phase | Tool | Question answered |
| --- | --- | --- |
| **Map** | CodeGraph | Which symbols, files, call paths, and dependents matter? |
| **Outline** | `ast-grep outline` | What is the compact structure of each candidate file? |
| **Match** | ast-grep `run` or `scan` | Which nodes have the exact syntax shape? |

CodeGraph is a cross-file semantic index. `outline` is a local, syntax-only table of contents. `run` and `scan` perform AST matching. A language server, compiler, and project tests remain the authorities for type and behavioral correctness.

Use ordinary source navigation for a small known one-file change. Use this skill when repository-scale discovery or structural matching changes the result.

## Setup branch

1. Inspect the repository and existing tools. Check `codegraph version`, `codegraph status`, `ast-grep --version`, and `ast-grep outline --help` where available.
   **Complete when:** installed versions, index state, and existing configuration are known.
2. Read `references/setup-and-mcp-config.md`. Present the exact install, registration, and initialization commands before any machine or repository change.
   **Complete when:** the user has approved the scope and commands, or the branch ends with a diagnostics-only report.
3. Execute only the approved plan. Restart the MCP client after registration, then verify the CLI and MCP paths.
   **Complete when:** `codegraph status` reports an index, `codegraph_explore` is available or the CLI fallback is recorded, and `ast-grep outline --help` succeeds.

## Exploration and refactor branch

1. **Map.** Prefer the default MCP tool `codegraph_explore`; use `codegraph explore` as its CLI equivalent. Use narrower CLI commands such as `query`, `callers`, `callees`, `impact`, `files`, or `affected` when their focused output is the goal. If no index exists, keep indexing as the user's decision and use the runtime's normal source-navigation tools.
   **Complete when:** the relevant entry points, relationships, candidate files, and expected impact are identified.
2. **Outline.** Run `ast-grep outline <file>` for every candidate source file before opening implementation ranges. Use `ast-grep outline <dir>` to map a candidate directory's exported surface. Invoke the `ast-grep-outline` skill for its navigation and flag guidance.
   **Complete when:** every candidate source file has an outline, or an unsupported language/file is recorded with the direct-read fallback.
3. **Match.** Use `ast-grep run` for a simple node pattern. Use `ast-grep scan` for relational, composite, reusable, or project rules. Invoke the `ast-grep` skill for rule authoring rather than duplicating its syntax guidance here.
   **Complete when:** the pattern matches a known positive example, rejects a plausible negative example, and the repository scan is scoped to relevant paths.
4. Make only the requested change. Preview rewrite matches before applying them, then run the smallest language-server, typecheck, lint, test, or build checks that cover the behavior.
   **Complete when:** every changed call site and observable contract is accounted for by focused validation.

Read `references/usage-playbook.md` before choosing commands for exploration, impact analysis, or refactor work.

## Guardrails

- Treat installation, MCP registration, project initialization, and configuration writes as approval boundaries; show the exact commands and scope first.
- Use `codegraph install` as the primary registration path. For manual setup, inspect `codegraph install --print-config <client>` and the current client's MCP documentation.
- Keep configuration excerpts minimal and redact secrets, headers, private paths, and internal hostnames.
- Keep ast-grep rewrites in match-only or interactive review until the user has requested application and reviewed the patch.
- Use the CLI equivalents when MCP is unavailable, and state which MCP behavior was not verified.

## Recovery

- Missing CodeGraph CLI or index: switch to the setup branch or continue with normal source navigation.
- Missing `codegraph_explore` after registration: restart the MCP client, check `codegraph status`, then follow the setup reference.
- Missing `outline` subcommand: update ast-grep from an official installation method; until then, use targeted source reads and record the fallback.
- Empty ast-grep results: test a smaller pattern against known code and inspect it with `--debug-query=cst` before widening the search.
- Stale CodeGraph response after an edit: heed any staleness banner; auto-sync is the default, while `codegraph sync` is the manual fallback.
