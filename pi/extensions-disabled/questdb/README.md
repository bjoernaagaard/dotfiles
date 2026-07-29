# QuestDB Pi Extension

This extension adds a focused QuestDB workflow to Pi with explicit activation and safe defaults. Guidance is carried by the hub, tool schemas/descriptions, bounded results, and conditional session context; the package does not bundle a skill.

The package declares its extension entry in `package.json` via `"pi": { "extensions": ["./index.ts"] }`, so it can be installed with `pi install` (npm/git/local path) per Pi package conventions.

## Features

- **safe defaults**: default `readOnly: true`
- **hub-only activation**: only the `questdb` hub tool is active by default; specialists stay inactive until the hub enables them
- **additive dynamic loading**: hub action enables one specialist at a time (plus hub); project evidence / explicit QuestDB intent inject system-prompt guidance only — they never bulk-enable the specialist suite
- **read/write split**: `questdb_query` remains read-only, `questdb_exec` requires confirmation for non-read statements and rejects headless writes
- **schema/ingest helpers**: typed SQL DDL and ILP Python generation
- **diagnostics**: validated diagnostic modes (`tables`, `table_columns`, `table_partitions`, `table_storage`, `materialized_views`, `memory_metrics`, `query_activity`, `_query_trace`)
- **docs helpers**: search/fetch QuestDB documentation from `llms.txt` markdown links only under `https://questdb.com/docs/`
- **REST client updates**: GET query execution via `/exec` with URL search params and optional `limit`
- **tool-native guidance**: the `questdb` hub and specialist descriptions carry activation, native SQL, and safety reminders without a bundled resource

## Footer status

QuestDB publishes its compact `questdb` segment through Pi's generic `ctx.ui.setStatus` API. It includes the endpoint, read/write mode, and active QuestDB tools. It does not call `setFooter` or depend on a statusline extension; `pi-statusline` can consume the segment when enabled.

## Guidance and workflow

Start with the `questdb` hub when a specialist is unavailable. Prefer `questdb_query` for exploration and query before writes; `questdb_exec` remains confirmation- and read-only-policy-gated. Use the schema, ingest, diagnostics, and docs tools for their typed workflows. The hub result and conditional QuestDB context reminder include the native SQL differences, while descriptions document the bounded and safe contracts.

## Configuration

Configuration merges sources with precedence: **global**, **trusted project**, then **environment**.

Default configuration is:

```json
{
  "baseUrl": "http://localhost:9000",
  "queryPath": "/exec",
  "timeoutMs": 10000,
  "defaultLimit": 200,
  "maxLimit": 1000,
  "readOnly": true,
  "preferredTools": []
}
```

Environment variables:

- `QUESTDB_BASE_URL`
- `QUESTDB_QUERY_PATH`
- `QUESTDB_TIMEOUT_MS` / `QUESTDB_QUERY_TIMEOUT_MS`
- `QUESTDB_DEFAULT_LIMIT`
- `QUESTDB_MAX_LIMIT`
- `QUESTDB_READ_ONLY`
- `QUESTDB_TOKEN` / `QUESTDB_API_TOKEN`
- `QUESTDB_USERNAME`
- `QUESTDB_PASSWORD`
- `QUESTDB_PREFERRED_TOOLS`

Global config: `getAgentDir()/questdb.json` (default `~/.pi/agent/questdb.json`, or `$PI_CODING_AGENT_DIR/questdb.json`)

Project config (trusted only): `{CONFIG_DIR_NAME}/questdb.json` (default `.pi/questdb.json`)

## Tools

- `questdb_query` – execute read-only SQL only
- `questdb_exec` – execute any SQL, confirms mutation statements
- `questdb_schema` – generate validated `CREATE TABLE` DDL
- `questdb_ingest` – generate Python ILP snippet (`certifi`, `Sender.from_conf`, `protocol_version`)
- `questdb_diagnose` – diagnostic SQL helpers
- `questdb_docs` – search/fetch docs
- `questdb` – hub to enable specialist tooling dynamically

## Commands

- `/questdb` prints active config summary and config provenance (`global` / `project` / `env`).

## Development / validation

From `~/.dotfiles/.pi/agent/extensions/questdb`:

```bash
npm install
npm test
npm run typecheck
```
