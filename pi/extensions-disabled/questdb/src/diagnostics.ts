import { Type, type Static } from "typebox";
import { StringEnum } from "@earendil-works/pi-ai";

export const DIAGNOSTIC_MODES = [
	"tables",
	"table_columns",
	"table_partitions",
	"table_storage",
	"materialized_views",
	"memory_metrics",
	"query_activity",
	"_query_trace",
] as const;

export type DiagnosticMode = (typeof DIAGNOSTIC_MODES)[number];

const MODE_REQUIRING_TABLE = new Set<DiagnosticMode>(["table_columns", "table_partitions"]);

export const DiagnosticsToolSchema = Type.Object({
	mode: StringEnum(DIAGNOSTIC_MODES),
	table: Type.Optional(Type.String({ description: "Required for table_columns and table_partitions." })),
});

export type DiagnosticsToolParams = Static<typeof DiagnosticsToolSchema>;

function validateIdentifier(name: string): string {
	const trimmed = name.trim();
	if (!trimmed) {
		throw new Error("Table name is required for this diagnostic mode.");
	}
	if (!/^[A-Za-z_][A-Za-z0-9_]{0,62}$/.test(trimmed)) {
		throw new Error(`Invalid table name: ${name}`);
	}
	return trimmed;
}

function quoteSqlLiteral(value: string): string {
	return `'${value.replace(/'/g, "''")}'`;
}

export function resolveDiagnosticMode(mode: string): DiagnosticMode {
	if (DIAGNOSTIC_MODES.includes(mode as DiagnosticMode)) {
		return mode as DiagnosticMode;
	}
	throw new Error(`Unknown diagnostic mode: ${mode}`);
}

export function buildDiagnosticQuery(mode: DiagnosticMode, table?: string): string {
	if (MODE_REQUIRING_TABLE.has(mode)) {
		const tableName = validateIdentifier(table ?? "");
		switch (mode) {
			case "table_columns":
				return `SELECT * FROM table_columns(${quoteSqlLiteral(tableName)})`;
			case "table_partitions":
				return `SELECT * FROM table_partitions(${quoteSqlLiteral(tableName)})`;
			default:
				throw new Error(`Invalid table-dependent diagnostic mode: ${mode}`);
		}
	}

	switch (mode) {
		case "tables":
			return "SELECT * FROM tables()";
		case "table_storage":
			return "SELECT * FROM table_storage()";
		case "materialized_views":
			return "SELECT * FROM materialized_views()";
		case "memory_metrics":
			return "SELECT * FROM memory_metrics()";
		case "query_activity":
			return "SELECT * FROM query_activity()";
		case "_query_trace":
			return "SELECT * FROM _query_trace";
		default:
			throw new Error(`Unsupported diagnostic mode: ${mode}`);
	}
}
