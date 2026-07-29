import type { IngestColumnDef, IngestInput, SchemaColumnDef, SchemaInput, SqlQueryType } from "./types.ts";

export const IDENTIFIER_RE = /^[A-Za-z_][A-Za-z0-9_]{0,62}$/;

const ALLOWED_SQL_TYPES = new Set([
	"BOOLEAN",
	"BYTE",
	"SHORT",
	"INT",
	"LONG",
	"FLOAT",
	"DOUBLE",
	"CHAR",
	"VARCHAR",
	"SYMBOL",
	"TIMESTAMP",
	"DATE",
	"LONG256",
	"GEOHASH",
	"UUID",
	"IPv4",
	"DOUBLE[]",
	"FLOAT[]",
	"INT[]",
	"LONG[]",
	"SHORT[]",
	"UUID[]",
]);

const READONLY_PREFIXES = new Set(["SELECT", "WITH", "SHOW", "EXPLAIN", "DESCRIBE"]);
const READONLY_FUNCTIONS = new Set([
	"TABLES",
	"TABLE_COLUMNS",
	"TABLE_PARTITIONS",
	"TABLE_STORAGE",
	"MATERIALIZED_VIEWS",
	"MEMORY_METRICS",
	"QUERY_ACTIVITY",
	"_QUERY_TRACE",
]);

const MUTATING_KEYWORDS = /\b(INSERT|UPDATE|DELETE|CREATE|ALTER|DROP|TRUNCATE|GRANT|REVOKE|MERGE|VACUUM|ATTACH|DETACH|COPY|UPSERT)\b/i;

export function splitSqlStatements(sql: string): string[] {
	const statements: string[] = [];
	let current = "";
	let quote: "'" | '"' | "`" | null = null;
	let inLineComment = false;
	let inBlockComment = false;
	let escaped = false;

	for (let i = 0; i < sql.length; i += 1) {
		const char = sql[i];
		const next = sql[i + 1] ?? "";

		if (inLineComment) {
			current += char;
			if (char === "\n") {
				inLineComment = false;
			}
			continue;
		}

		if (inBlockComment) {
			current += char;
			if (char === "*" && next === "/") {
				inBlockComment = false;
				i += 1;
				current += "/";
			}
			continue;
		}

		if (quote === null && char === "-" && next === "-") {
			inLineComment = true;
			current += "--";
			i += 1;
			continue;
		}
		if (quote === null && char === "/" && next === "*") {
			inBlockComment = true;
			current += "/*";
			i += 1;
			continue;
		}

		if (quote !== null) {
			current += char;
			if (!escaped && char === quote) {
				quote = null;
			} else if (char === "\\") {
				escaped = !escaped;
			} else {
				escaped = false;
			}
			continue;
		}

		if (char === "'" || char === '"' || char === "`") {
			quote = char;
			escaped = false;
			current += char;
			continue;
		}

		if (char === ";") {
			const statement = current.trim();
			if (statement.length > 0) {
				statements.push(statement);
			}
			current = "";
			continue;
		}

		current += char;
	}

	const tail = current.trim();
	if (tail.length > 0) {
		statements.push(tail);
	}

	return statements;
}

export function stripLiterals(sql: string): string {
	return sql
		.replace(/'(?:[^'\\]|\\.)*'/g, (match) => match.replace(/./g, " "))
		.replace(/"(?:[^"\\]|\\.)*"/g, (match) => match.replace(/./g, " "))
		.replace(/`(?:[^`\\]|\\.)*`/g, (match) => match.replace(/./g, " "))
		.replace(/--[^\n]*/g, "")
		.replace(/\/\*[\s\S]*?\*\//g, "");
}

export function classifyStatement(sql: string): SqlQueryType {
	const statements = splitSqlStatements(sql);
	if (statements.length !== 1) {
		throw new Error("Multi-statement SQL is not allowed.");
	}

	const normalized = statements[0].trim().replace(/\s+/g, " ");
	if (!normalized) {
		return "unknown";
	}

	const noComments = stripLiterals(normalized).toUpperCase();
	if (MUTATING_KEYWORDS.test(noComments)) {
		return "write";
	}

	const match = noComments.match(/^([A-Z_][A-Z0-9_]*)/);
	if (!match) {
		return "unknown";
	}
	const first = match[1];

	if (READONLY_PREFIXES.has(first) || READONLY_FUNCTIONS.has(first)) {
		return "read";
	}

	return "unknown";
}

export function splitSingleStatement(sql: string): string {
	const statements = splitSqlStatements(sql);
	if (statements.length !== 1) {
		throw new Error("Exactly one SQL statement is required.");
	}
	return statements[0].trim();
}

export function validateIdentifier(identifier: string): string {
	if (!IDENTIFIER_RE.test(identifier)) {
		throw new Error(`Invalid identifier: ${identifier}`);
	}
	return identifier;
}

export function ensureReadOnlyQuery(sql: string): void {
	if (classifyStatement(sql) !== "read") {
		throw new Error("Query contains write or unsupported SQL and is not allowed in read-only mode.");
	}
}

export function extractSqlHead(sql: string): string {
	const first = splitSingleStatement(sql);
	return first.trim();
}

export function normalizeType(type: string): string {
	const normalized = type.trim().toUpperCase();
	if (!ALLOWED_SQL_TYPES.has(normalized)) {
		throw new Error(`Unsupported column type: ${type}`);
	}
	return normalized;
}

export function validateColumns(columns: SchemaColumnDef[], symbols: Set<string>): SchemaColumnDef[] {
	const seen = new Set<string>();
	return columns.map((column) => {
		const name = column.name?.trim();
		if (!name || !IDENTIFIER_RE.test(name)) {
			throw new Error(`Invalid column name: ${column.name}`);
		}
		if (seen.has(name)) {
			throw new Error(`Duplicate column name: ${name}`);
		}
		seen.add(name);
		const type = normalizeType(String(column.type));
		if (symbols.has(name) && type !== "SYMBOL") {
			throw new Error(`Symbol columns must use SYMBOL type: ${name}`);
		}
		return { name, type };
	});
}

export function validatePartition(partitionBy?: string): "DAY" | "MONTH" | "YEAR" | "HOUR" {
	if (!partitionBy) {
		return "DAY";
	}

	const normalized = partitionBy.trim().toUpperCase();
	if (normalized === "DAY" || normalized === "MONTH" || normalized === "YEAR" || normalized === "HOUR") {
		return normalized;
	}
	throw new Error(`Unsupported partition by value: ${partitionBy}`);
}

export function validateDedupKeys(
	dedupKeys: string[] | undefined,
	columns: SchemaColumnDef[],
	timestampColumn: string,
	wal: boolean,
): string[] {
	if (!wal) {
		throw new Error("DEDUP requires WAL=true.");
	}

	const existing = new Set(columns.map((column) => column.name));
	const sanitized: string[] = [];
	const seen = new Set<string>();
	const source = dedupKeys && dedupKeys.length > 0 ? dedupKeys : [timestampColumn];

	for (const key of source) {
		const name = key.trim();
		if (!name || !IDENTIFIER_RE.test(name)) {
			throw new Error(`Invalid dedup key: ${key}`);
		}
		if (!existing.has(name)) {
			throw new Error(`Dedup key not in columns: ${name}`);
		}
		if (!seen.has(name)) {
			sanitized.push(name);
			seen.add(name);
		}
	}

	if (!sanitized.includes(timestampColumn)) {
		throw new Error("DEDUP requires timestamp column in dedup keys.");
	}

	return sanitized;
}

export function generateSchemaDdl(input: SchemaInput): string {
	if (!IDENTIFIER_RE.test(input.tableName)) {
		throw new Error("Invalid table name");
	}
	if (!IDENTIFIER_RE.test(input.timestampColumn)) {
		throw new Error("Invalid timestamp column");
	}

	const symbolColumns = new Set((input.symbolColumns ?? []).map((name) => name.trim()).filter(Boolean));
	const columns = validateColumns(input.columns, symbolColumns);
	if (!columns.some((column) => column.name === input.timestampColumn)) {
		throw new Error("Timestamp column must be present in columns");
	}
	if (columns.find((column) => column.name === input.timestampColumn)?.type !== "TIMESTAMP") {
		throw new Error("Timestamp column must be TIMESTAMP");
	}

	const partitionBy = validatePartition(input.partitionBy);
	const useWal = input.wal !== false;
	const dedup = input.dedup === true;
	const dedupKeys = dedup ? validateDedupKeys(input.dedupKeys, columns, input.timestampColumn, useWal) : [input.timestampColumn];

	const columnSql = columns
		.map((column) => `"${column.name}" ${column.type}`)
		.join(",\n");

	let ddl = `CREATE TABLE IF NOT EXISTS "${input.tableName}" (\n${columnSql}\n)`;
	ddl += `\nTIMESTAMP("${input.timestampColumn}") PARTITION BY ${partitionBy}`;
	if (useWal) {
		ddl += " WAL";
	}
	if (dedup) {
		ddl += `\nDEDUP UPSERT KEYS(${dedupKeys.map((key) => `"${key}"`).join(", ")})`;
	}
	ddl += ";";
	return ddl;
}

function formatIngestPythonValue(column: IngestColumnDef): string {
	const name = column.name;
	const type = normalizeType(column.type);
	const expr = `row["${name}"]`;

	if (type.endsWith("[]")) {
		return `np.asarray(${expr}, dtype=np.float64)`;
	}

	switch (type) {
		case "BOOLEAN":
			return `bool(${expr})`;
		case "BYTE":
		case "SHORT":
		case "INT":
		case "LONG":
			return `int(${expr})`;
		case "FLOAT":
		case "DOUBLE":
			return `float(${expr})`;
		case "UUID":
		case "UUID[]":
		case "CHAR":
		case "VARCHAR":
		case "GEOHASH":
		case "IPv4":
		case "DATE":
		case "TIMESTAMP":
		case "LONG256":
			return `str(${expr})`;
		default:
			return expr;
	}
}

function validateIngestColumns(columns: IngestColumnDef[], timestampColumn: string): IngestColumnDef[] {
	const normalized = columns.map((column) => {
		const name = column.name?.trim();
		if (!name || !IDENTIFIER_RE.test(name)) {
			throw new Error(`Invalid column name: ${column.name}`);
		}
		const type = normalizeType(String(column.type));
		return { name, type };
	});

	if (!normalized.some((column) => column.name === timestampColumn)) {
		throw new Error("Timestamp column must be included in columns.");
	}

	if (!IDENTIFIER_RE.test(timestampColumn)) {
		throw new Error("Invalid timestamp column");
	}

	const seen = new Set<string>();
	for (const column of normalized) {
		if (seen.has(column.name)) {
			throw new Error(`Duplicate column name: ${column.name}`);
		}
		seen.add(column.name);
	}

	return normalized;
}

export function generateIngestScript(input: IngestInput): string {
	const transport = (input.transport ?? "tcp").toLowerCase();
	if (transport !== "tcp" && transport !== "http") {
		throw new Error("transport must be tcp or http");
	}
	if (!IDENTIFIER_RE.test(input.tableName)) {
		throw new Error("Invalid table name");
	}
	if (!IDENTIFIER_RE.test(input.timestampColumn)) {
		throw new Error("Invalid timestamp column");
	}

	const host = input.host?.trim() || "localhost";
	const port = input.port && input.port > 0 ? input.port : transport === "http" ? 9000 : 9009;
	const protocolVersion = input.protocolVersion ?? 2;

	const columns = validateIngestColumns(input.columns, input.timestampColumn);
	if (transport === "tcp" && protocolVersion < 2) {
		throw new Error("TCP transport requires protocol_version>=2 for array support");
	}

	const conf = transport === "tcp"
		? `tcp::addr=${host}:${port};protocol_version=${Math.max(2, protocolVersion)};`
		: `http::addr=${host}:${port};`;

	const symbolColumns = columns.filter((column) => column.type === "SYMBOL");
	const dataColumns = columns.filter((column) => column.type !== "SYMBOL" && column.name !== input.timestampColumn);

	const symbolPayload = symbolColumns
		.map((column) => `        "${column.name}": str(${`row[\"${column.name}\"]`})`)
		.join(",\n") || "";
	const columnsPayload = dataColumns
		.map((column) => `        "${column.name}": ${formatIngestPythonValue(column)}`)
		.join(",\n") || "";

	const timestampExpr = input.timestampExpr?.trim()
		? input.timestampExpr.trim()
		: `TimestampNanos(int(row["${input.timestampColumn}"]))`;

	return `# Generated QuestDB ILP Python snippet\n`
		+ `import certifi\nimport numpy as np\nfrom questdb.ingress import Sender, TimestampNanos\n\n`
		+ `import os\n\nos.environ[\"SSL_CERT_FILE\"] = certifi.where()\n\n`
		+ `conf = \"${conf}\"\n\n`
		+ `def publish(row):\n`
		+ `    with Sender.from_conf(conf) as sender:\n`
		+ `        sender.row(\n`
		+ `            \"${input.tableName}\",\n`
		+ `            symbols={\n${symbolPayload}\n            },\n`
		+ `            columns={\n${columnsPayload}\n            },\n`
		+ `            at=${timestampExpr},\n`
		+ `        )\n`
		+ `        sender.flush()\n`;
}
