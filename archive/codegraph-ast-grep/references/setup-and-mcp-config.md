# Setup and MCP configuration

Read this reference only for installation, client registration, repository initialization, or repair.

## Approval boundary

Inspect first. Show the exact commands, files, install location, and repository effects before changing the machine or repository. Diagnostics such as version/help/status commands are safe to run without mutation.

## Preflight

From the target repository, establish:

```text
codegraph version
codegraph status
ast-grep --version
ast-grep outline --help
```

Also inspect whether `.codegraph/`, `codegraph.json`, `sgconfig.yml`, or `sgconfig.yaml` already exists. CodeGraph bundles its runtime, so a separate Node installation is not required for the bundled CLI. A package-manager installation can have its own prerequisite.

## CodeGraph installation and registration

1. Select a current installation method from the official installation page. Present its source and effects for approval instead of silently executing a remote installer.
2. Register installed MCP clients with the interactive command:

```text
codegraph install
```

Useful non-interactive and inspection forms are:

```text
codegraph install --yes
codegraph install --target=<client-id> --yes
codegraph install --print-config <client-id>
```

`codegraph install` is the primary path because it detects supported clients and writes their MCP registration. `--print-config` emits a snippet without writing client configuration; use it with the current client's MCP documentation when manual setup is necessary. The underlying stdio server command is `codegraph serve --mcp`.

Restart the client after registration. The default MCP surface exposes one tool, `codegraph_explore`. Additional narrower tools exist but are unlisted unless `CODEGRAPH_MCP_TOOLS` enables them; prefer the default unless the user has a concrete need for a larger tool surface.

## Repository initialization

With approval, initialize from the project root:

```text
codegraph init
codegraph status
```

`codegraph init` creates `.codegraph/` and builds the index. The MCP server watches source changes and auto-syncs by default. Reserve `codegraph sync` for manual recovery or scripts. Remove a project index with `codegraph uninit` only when the user requests that destructive action.

## ast-grep installation

Choose a current method from the official ast-grep installation page, then verify both the base CLI and the outline subcommand:

```text
ast-grep --version
ast-grep outline --help
```

Use `ast-grep` rather than the short `sg` executable where `sg` collides with another system command. The combined workflow needs the CLI; an ast-grep MCP server is optional.

## Configuration

CodeGraph needs no configuration for standard extensions. It stores its SQLite index at `.codegraph/codegraph.db`, uses WAL mode where the filesystem supports it, honors `.gitignore`, and excludes common dependency/build directories and files larger than 1 MB.

The optional project-root `codegraph.json` supports:

- `exclude`: omit additional tracked paths.
- `include`: force selected gitignored source paths into the graph.
- `extensions`: map custom extensions to supported languages.
- `includeIgnored`: include nested repositories inside ignored paths.

An explicit exclusion still wins over an inclusion. Built-in exclusions cannot be re-included. Keep index data inside `.codegraph/`; project options belong in `codegraph.json`.

ast-grep uses `sgconfig.yml` for project rules, custom languages, and related configuration. Simple `run` patterns and the bundled outline extractors work without it.

## Repair

### MCP tool absent

Restart the client, run `codegraph status`, and rerun `codegraph install` if registration is missing. The client starts `codegraph serve --mcp`; a separate long-running server launch is not the normal path.

### No index

Run `codegraph init` only after repository initialization is approved. An MCP client can query a different indexed project by passing its project path when that tool surface supports `projectPath`.

### Missing or stale symbols

Check the language support, default exclusions, `.gitignore`, and `codegraph.json`. Wait for the watcher debounce after a save. Use `codegraph sync` when manual synchronization is needed.

### Lock or journal warning

Use `codegraph status` to inspect the SQLite backend and journal mode. `codegraph unlock` removes a stale indexing lock. For persistent non-WAL behavior, move the index to a local filesystem rather than a network share or cross-environment mount.

### ast-grep lacks `outline`

Confirm with `ast-grep outline --help`, then update the CLI using an official installation method. Record targeted reads as the fallback until the subcommand is available.

### ast-grep finds no matches

Invoke the `ast-grep` skill. Confirm the language, test a minimal pattern against known code, and inspect the parsed query with `--debug-query=cst` before broadening the scan.

## Primary sources

- CodeGraph installation: <https://colbymchenry.github.io/codegraph/getting-started/installation/>
- CodeGraph CLI: <https://colbymchenry.github.io/codegraph/reference/cli/>
- CodeGraph MCP server: <https://colbymchenry.github.io/codegraph/reference/mcp-server/>
- CodeGraph configuration: <https://colbymchenry.github.io/codegraph/getting-started/configuration/>
- CodeGraph indexing: <https://colbymchenry.github.io/codegraph/guides/indexing/>
- ast-grep installation: <https://astgrep.com/guide/quick-start.html>
- ast-grep CLI: <https://astgrep.com/reference/cli.html>
