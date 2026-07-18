export const QUESTDB_NATIVE_GUIDANCE = [
	"QuestDB is not PostgreSQL: use SAMPLE BY instead of time_bucket(), LATEST ON instead of DISTINCT ON, and a subquery instead of HAVING.",
	"Prefer TICK timestamp filters. Choose ASOF, LT, SPLICE, HORIZON, WINDOW, or LATERAL JOIN by temporal semantics.",
	"Time-series tables need a designated TIMESTAMP; use SYMBOL for repeated strings, WAL for concurrent ingestion, and ILP for streaming writes.",
].join(" ");

export const QUESTDB_SESSION_GUIDANCE = `QuestDB context detected. ${QUESTDB_NATIVE_GUIDANCE}`;
export const QUESTDB_HUB_SNIPPET = "Activate QuestDB tools and return native QuestDB SQL guidance";
export const QUESTDB_HUB_GUIDELINE = [
	"Use questdb when the user asks about QuestDB schema, SQL, ingestion, diagnostics, or documentation; activate only the specialist needed.",
	"Prefer questdb_query for exploration and query-before-exec; questdb_exec is for confirmed writes/DDL and remains subject to read-only mode and UI confirmation.",
	"QuestDB is not PostgreSQL: use SAMPLE BY, LATEST ON, TICK filters, temporal joins, designated TIMESTAMP, SYMBOL, WAL, and ILP; use questdb_docs as the official syntax fallback.",
	"Use questdb_schema for validated timestamp/SYMBOL/partition/WAL/dedup DDL, questdb_ingest for ILP timestamp generation, and questdb_diagnose for validated catalog/storage/memory/activity modes.",
];
