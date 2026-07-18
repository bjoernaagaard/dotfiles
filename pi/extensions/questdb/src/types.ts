export interface QuestDbRuntimeConfig {
	baseUrl: string;
	queryPath: string;
	timeoutMs: number;
	defaultLimit: number;
	maxLimit: number;
	readOnly: boolean;
	authToken?: string;
	basicUsername?: string;
	basicPassword?: string;
	preferredTools: string[];
	source: QuestDbConfigSource;
}

export interface QuestDbConfigFile {
	baseUrl?: string;
	queryPath?: string;
	timeoutMs?: number;
	defaultLimit?: number;
	maxLimit?: number;
	readOnly?: boolean;
	preferredTools?: string[];
}

export interface LoadedQuestDbConfig {
	config: QuestDbRuntimeConfig;
	hasProjectConfig: boolean;
	hasGlobalConfig: boolean;
}

export type QuestDbConfigSource = "default" | "global" | "project" | "env";

export type SqlQueryType = "read" | "write" | "unknown";

export interface QuestDbColumnInfo {
	name: string;
	type: string;
}

export interface QuestDbSelectResult {
	kind: "select";
	columns: QuestDbColumnInfo[];
	dataset: unknown[][];
}

export interface QuestDbMutationResult {
	kind: "mutation";
	ddl: string;
	updated: number;
}

export type QuestDbQueryResult = QuestDbSelectResult | QuestDbMutationResult;

export type QuestDbQuerySource = {
	query: string;
	columns: QuestDbColumnInfo[];
};

export interface SchemaColumnDef {
	name: string;
	type: string;
}

export interface SchemaInput {
	tableName: string;
	timestampColumn: string;
	columns: SchemaColumnDef[];
	symbolColumns?: string[];
	partitionBy?: "DAY" | "MONTH" | "YEAR" | "HOUR";
	wal?: boolean;
	dedup?: boolean;
	dedupKeys?: string[];
}

export interface IngestColumnDef {
	name: string;	type: string;
}

export interface IngestInput {
	tableName: string;
	timestampColumn: string;
	columns: IngestColumnDef[];
	host?: string;
	port?: number;
	transport?: "tcp" | "http";
	protocolVersion?: number;
	timestampExpr?: string;
}

export interface ToolIntentHints {
	forceTools: Set<string>;
	hasQuestDbIntent: boolean;
	queryMode: string[];
}

export interface TruncationInfo {
	content: string;
	truncated: boolean;
	totalLines: number;
	totalBytes: number;
	outputLines: number;
	outputBytes: number;
}

export type SqlErrorCode =
	| "multi_statement"
	| "read_only_violation"
	| "invalid_identifier"
	| "invalid_type"
	| "invalid_partition"
	| "invalid_limit"
	| "invalid_query"
	| "network_error"
	| "query_error";
