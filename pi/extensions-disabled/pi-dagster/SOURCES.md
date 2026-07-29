# Verification sources

This directory vendors the source material used to verify `PROPOSAL.md`.

## Revisions

- Pi coding agent: `@earendil-works/pi-coding-agent@0.80.8`
- Pi repository tag: `v0.80.8`
- Pi tag commit: `fae7176cb9f7c4725a40d9d481d8d70b80f18086`
- Dagster repository commit: `ed9a1483a94831c6feefa333086c3d4efec05a4b`

## Pi Extension API

Vendored under `sources/pi-0.80.8/`:

| File | Verifies |
|---|---|
| `package.json` | Exact installed Pi package version and repository provenance |
| `extensions.md` | Extension events, tools, commands, state, providers, UI, modes, and examples |
| `extension-types.d.ts` | Exact TypeScript interfaces for `ExtensionAPI`, contexts, tools, UI, and events |
| `tui.md` | Components, overlays, input, rendering, themes, and performance |
| `session-format.md` | Session entries, branching, labels, custom messages, and `SessionManager` |
| `compaction.md` | Compaction and branch-summarization extension hooks |
| `rpc.md` | Headless operation and extension UI behavior in RPC mode |
| `packages.md` | Package manifests, resources, dependencies, and distribution |
| `keybindings.md` | Namespaced keybindings and customization |
| `themes.md` | Theme format and color tokens |

Pinned upstream references:

- <https://github.com/earendil-works/pi/blob/v0.80.8/packages/coding-agent/docs/extensions.md>
- <https://github.com/earendil-works/pi/blob/v0.80.8/packages/coding-agent/docs/tui.md>
- <https://github.com/earendil-works/pi/blob/v0.80.8/packages/coding-agent/docs/session-format.md>
- <https://github.com/earendil-works/pi/blob/v0.80.8/packages/coding-agent/docs/compaction.md>
- <https://github.com/earendil-works/pi/tree/v0.80.8/packages/coding-agent/examples/extensions>

## Dagster OSS GraphQL

Vendored under `sources/dagster-oss/graphql/`:

| File | Verifies |
|---|---|
| `schema.graphql` | Complete query, mutation, subscription, input, object, interface, enum, and union surface |
| `ROOT_FIELDS.md` | Derived inventory of root operations: 65 queries, 40 mutations, and 3 subscriptions |

Pinned upstream schema:

- <https://github.com/dagster-io/dagster/blob/ed9a1483a94831c6feefa333086c3d4efec05a4b/js_modules/ui-core/src/graphql/schema.graphql>

`ROOT_FIELDS.md` is a convenience index. `schema.graphql` remains authoritative.

## Local `dg` development surface

Vendored under `sources/dagster-oss/dg/`:

| File | Verifies |
|---|---|
| `create-dagster-scaffold.py` | Project and workspace scaffolding |
| `check.py` | Definition, YAML, and TOML validation commands |
| `dev.py` | Local development webserver and daemon startup |
| `launch.py` | Local asset/job execution, partitions, ranges, and run config |
| `scaffold-defs.py` | Definition and component-instance scaffolding |
| `scaffold-component.py` | Custom component-type scaffolding |

These files were copied from the Dagster repository at the revision above.

## Dagster authoring documentation

Vendored under `sources/dagster-oss/docs/`:

| File | Verifies |
|---|---|
| `asset-selection-examples.md` | Asset selection expressions and traversal examples |
| `workspaces-dg-toml.md` | Workspace/project configuration |
| `declarative-automation.md` | Automation-condition concepts and workflows |
| `schedules.md` | Schedule concepts and management |
| `sensors.md` | Sensor concepts and management |

## Integrity

`sources/SHA256SUMS` records the SHA-256 digest of every vendored source and derived inventory.

Verify the snapshots:

```bash
cd /Users/bsa/projects/pi-dagster
shasum -a 256 -c sources/SHA256SUMS
```

Verify the root-operation counts directly from the schema:

```bash
rg '^type (Query|Mutation|Subscription) \{' sources/dagster-oss/graphql/schema.graphql
```

For field-by-field inspection, use `sources/dagster-oss/graphql/ROOT_FIELDS.md` and then confirm the field definition in `schema.graphql`.
