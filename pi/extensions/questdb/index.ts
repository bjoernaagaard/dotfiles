import {
	DEFAULT_MAX_BYTES,
	DEFAULT_MAX_LINES,
	type ExtensionAPI,
	type ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import { StringEnum } from "@earendil-works/pi-ai";
import { Type, type Static } from "typebox";
import { executeQuestDbQuery } from "./src/questdb-client.ts";
import {
	computeActiveTools,
	inferIntentTools,
	mergeToolLists,
	reconstructSessionActivation,
	shouldInjectQuestDbGuidance,
	TOOL_DIAGNOSE,
	TOOL_DOCS,
	TOOL_EXEC,
	TOOL_HUB,
	TOOL_INGEST,
	TOOL_QUERY,
	TOOL_SCHEMA,
} from "./src/intent.ts";
import {
	clampLimit,
	DEFAULT_QUESTDB_CONFIG,
	loadQuestDbConfig,
	MAX_LIMIT_CEILING,
	safeConfigSummary,
} from "./src/config.ts";
import {
	DIAGNOSTIC_MODES,
	buildDiagnosticQuery,
	DiagnosticsToolSchema,
	type DiagnosticsToolParams,
} from "./src/diagnostics.ts";
import {
	DocsToolSchema,
	filterDocReferences,
	parseDocsReferences,
	QUESTDB_DOCS_INDEX,
	resolveDocsRequest,
	type DocsToolParams,
} from "./src/docs.ts";
import { QUESTDB_HUB_GUIDELINE, QUESTDB_HUB_SNIPPET, QUESTDB_NATIVE_GUIDANCE, QUESTDB_SESSION_GUIDANCE } from "./src/guidance.ts";
import {
	classifyStatement,
	extractSqlHead,
	generateIngestScript,
	generateSchemaDdl,
	splitSingleStatement,
} from "./src/sql.ts";
import { detectQuestDbProjectEvidence } from "./src/project.ts";
import {
	formatQuestDbStatusFromConfig,
	QUESTDB_STATUS_KEY,
} from "./src/status.ts";
import { formatWithTruncation } from "./src/truncate-output.ts";
import { type QuestDbQueryResult, type QuestDbRuntimeConfig, type SqlQueryType } from "./src/types.ts";

const QuerySchema = Type.Object({
	query: Type.String({
		description:
			"Single native QuestDB SQL read statement. Prefer SELECT/SHOW/WITH exploration; QuestDB is not PostgreSQL (use SAMPLE BY/LATEST ON and TICK filters).",
	}),
	limit: Type.Optional(
		Type.Integer({
			minimum: 1,
			maximum: MAX_LIMIT_CEILING,
			description: `Optional row limit (default ${DEFAULT_QUESTDB_CONFIG.defaultLimit}; values above config.maxLimit are clamped; absolute max ${MAX_LIMIT_CEILING}).`,
		}),
	),
});

const SchemaToolSchema = Type.Object({
	tableName: Type.String({ description: "Table name for the generated CREATE TABLE DDL." }),
	timestampColumn: Type.String({ description: "Designated TIMESTAMP column; time-series tables require one." }),
	columns: Type.Array(
		Type.Object({
			name: Type.String({ description: "Column name." }),
			type: Type.String({ description: "QuestDB column type." }),
		}),
		{ minItems: 1 },
	),
	symbolColumns: Type.Optional(Type.Array(Type.String(), { minItems: 1, description: "Repeated string columns to declare as SYMBOL." })),
	partitionBy: Type.Optional(StringEnum(["DAY", "HOUR", "MONTH", "YEAR"] as const, { description: "Partition period for the time-series table." })),
	wal: Type.Optional(Type.Boolean({ description: "Enable WAL for concurrent ingestion when appropriate." })),
	dedup: Type.Optional(Type.Boolean({ description: "Enable deduplication; provide matching dedupKeys when required." })),
	dedupKeys: Type.Optional(Type.Array(Type.String(), { minItems: 1, description: "Columns used for deduplication." })),
});

const IngestToolSchema = Type.Object({
	tableName: Type.String({ description: "Target QuestDB table name." }),
	timestampColumn: Type.String({ description: "Timestamp column to publish through ILP." }),
	columns: Type.Array(
		Type.Object({
			name: Type.String({ description: "Column name." }),
			type: Type.String({ description: "QuestDB column type." }),
		}),
		{ minItems: 1 },
	),
	host: Type.Optional(Type.String({ description: "Optional ILP host for the generated sender." })),
	port: Type.Optional(Type.Integer({ minimum: 1, maximum: 65_535, description: "Optional ILP port." })),
	transport: Type.Optional(StringEnum(["tcp", "http"] as const, { description: "ILP transport." })),
	protocolVersion: Type.Optional(Type.Integer({ minimum: 2, maximum: 999, description: "ILP protocol version." })),
	timestampExpr: Type.Optional(Type.String({ description: "Optional native timestamp expression; prefer explicit TICK-compatible timestamps." })),
});

const HubToolSchema = Type.Object({
	action: StringEnum(["query", "exec", "schema", "ingest", "diagnose", "docs"] as const),
});

type QueryParams = Static<typeof QuerySchema>;
type SchemaToolParams = Static<typeof SchemaToolSchema>;
type IngestToolParams = Static<typeof IngestToolSchema>;
type HubToolParams = Static<typeof HubToolSchema>;

type ExtensionState = {
	config: QuestDbRuntimeConfig;
	hasGlobalConfig: boolean;
	hasProjectConfig: boolean;
	isQuestDbProject: boolean;
	hasQuestDbContext: boolean;
};

let state: ExtensionState = {
	config: { ...DEFAULT_QUESTDB_CONFIG },
	hasGlobalConfig: false,
	hasProjectConfig: false,
	isQuestDbProject: false,
	hasQuestDbContext: false,
};

function textContent(value: string) {
	return { type: "text" as const, text: value };
}

function formatQueryResult(result: QuestDbQueryResult, elapsedMs: number, query: string): { content: Array<{ type: "text"; text: string }>; details: Record<string, unknown> } {
	if (result.kind === "mutation") {
		return {
			content: [textContent(`Mutation executed (${elapsedMs}ms)\n${result.ddl || ""}\nupdated=${result.updated}`)],
			details: {
				query: extractSqlHead(query),
				kind: "mutation",
				ddl: result.ddl,
				updated: result.updated,
				timeMs: elapsedMs,
		},
		};
	}

	// Full dataset in payload — truncateHead + temp file provide the recovery path (no silent 8-row loss).
	const fullOutput = JSON.stringify(
		{
			query: extractSqlHead(query),
			columns: result.columns,
			rowCount: result.dataset.length,
			rows: result.dataset,
		},
		null,
		2,
	);
	const formatted = formatWithTruncation(fullOutput, {
		maxLines: DEFAULT_MAX_LINES,
		maxBytes: DEFAULT_MAX_BYTES,
		prefix: "pi-questdb-query",
		extension: ".json",
	});
	return {
		content: [textContent(`Query result (${result.dataset.length} rows, ${elapsedMs}ms)\n${formatted.text}`)],
		details: {
			query: extractSqlHead(query),
			kind: "select",
			columns: result.columns,
			rowCount: result.dataset.length,
			timeMs: elapsedMs,
			truncation: formatted.truncation,
			fullOutputPath: formatted.fullOutputPath ?? null,
		},
	};
}

function statementLabel(type: SqlQueryType): string {
	if (type === "write") return "write";
	if (type === "read") return "read";
	return "unknown";
}

async function executeWithConfig(
	statement: string,
	config: QuestDbRuntimeConfig,
	signal: AbortSignal | undefined,
	ctx: ExtensionContext,
	limit: number,
	allowWrite: boolean,
): Promise<{ content: Array<{ type: "text"; text: string }>; details: Record<string, unknown> }> {
	const statementType = classifyStatement(statement);
	if (statementType === "unknown") {
		throw new Error("Unknown SQL statement type.");
	}

	if (!allowWrite && statementType !== "read") {
		throw new Error(`Read-only tool cannot execute ${statementLabel(statementType)} statements.`);
	}

	if (allowWrite && statementType === "write") {
		if (config.readOnly) {
			throw new Error("Read-only config blocks write statements.");
		}
		if (!ctx?.hasUI) {
			throw new Error("Write statements require an interactive session for confirmation.");
		}
		const ok = await ctx.ui.confirm("QuestDB write", `Execute mutating SQL\n\n${statement}`);
		if (!ok) {
			throw new Error("Execution cancelled by user.");
		}
	}

	const started = Date.now();
	const result = await executeQuestDbQuery(statement, config, signal, limit);
	return formatQueryResult(result, Date.now() - started, statement);
}

async function runDiagnostics(
	mode: DiagnosticsToolParams["mode"],
	table: DiagnosticsToolParams["table"],
	stateConfig: QuestDbRuntimeConfig,
	signal: AbortSignal | undefined,
): Promise<{ content: Array<{ type: "text"; text: string }>; details: Record<string, unknown> }> {
	const query = buildDiagnosticQuery(mode, table);
	const started = Date.now();
	const result = await executeQuestDbQuery(query, stateConfig, signal, 200);
	if (result.kind !== "select") {
		throw new Error("Diagnostic response was not a SELECT result.");
	}

	// Full diagnostic rows in payload; truncation writes recovery temp file when needed.
	const fullOutput = JSON.stringify(
		{
			mode,
			query,
			columns: result.columns,
			rowCount: result.dataset.length,
			rows: result.dataset,
		},
		null,
		2,
	);
	const formatted = formatWithTruncation(fullOutput, {
		maxLines: DEFAULT_MAX_LINES,
		maxBytes: DEFAULT_MAX_BYTES,
		prefix: "pi-questdb-diagnose",
		extension: ".json",
	});
	return {
		content: [textContent(`Diagnostics (${mode})\n${formatted.text}`)],
		details: {
			mode,
			query,
			timeMs: Date.now() - started,
			rowCount: result.dataset.length,
			columns: result.columns,
			truncation: formatted.truncation,
			fullOutputPath: formatted.fullOutputPath ?? null,
		},
	};
}

async function runDocs(
	params: DocsToolParams,
	signal: AbortSignal | undefined,
): Promise<{ content: Array<{ type: "text"; text: string }>; details: Record<string, unknown> }> {
	if (params.action === "fetch") {
		if (!params.path) {
			throw new Error("fetch requires a path or URL.");
		}
		const url = resolveDocsRequest(params.path);
		const response = await fetch(url, {
			signal,
			headers: { Accept: "text/plain, text/markdown, */*" },
		});
		if (!response.ok) {
			const body = await response.text();
			throw new Error(`Docs fetch failed: ${response.status} ${response.statusText}: ${body}`);
		}
		const content = await response.text();
		const fullOutput = `Source: ${url}\n\n${content}`;
		const formatted = formatWithTruncation(fullOutput, {
			maxLines: DEFAULT_MAX_LINES,
			maxBytes: DEFAULT_MAX_BYTES,
			prefix: "pi-questdb-docs",
			extension: ".md",
		});
		return {
			content: [textContent(formatted.text)],
			details: {
				action: "fetch",
				url,
				truncation: formatted.truncation,
				fullOutputPath: formatted.fullOutputPath ?? null,
			},
		};
	}

	const response = await fetch(QUESTDB_DOCS_INDEX, {
		signal,
		headers: { Accept: "text/plain" },
	});
	if (!response.ok) {
		throw new Error(`Docs search failed: ${response.status} ${response.statusText}`);
	}
	const indexText = await response.text();
	const refs = parseDocsReferences(indexText);
	const matches = filterDocReferences(refs, params.query ?? "", params.maxResults ?? 5);
	if (matches.length === 0) {
		return {
			content: [textContent(`No docs references for ${params.query || "(empty)"}`)],
			details: { query: params.query ?? null, hits: 0 },
		};
	}
	return {
		content: [textContent(`QuestDB docs references\n${matches.map((m, i) => `${i + 1}. ${m.url}`).join("\n")}`)],
		details: { query: params.query ?? null, hits: matches.length, urls: matches.map((m) => m.url) },
	};
}

function hubToolForAction(action: HubToolParams["action"]): string {
	switch (action) {
		case "query":
			return TOOL_QUERY;
		case "exec":
			return TOOL_EXEC;
		case "schema":
			return TOOL_SCHEMA;
		case "ingest":
			return TOOL_INGEST;
		case "diagnose":
			return TOOL_DIAGNOSE;
		case "docs":
			return TOOL_DOCS;
	}
}

function hubGuidance(action: HubToolParams["action"]): string {
	switch (action) {
		case "query":
			return "Use questdb_query for read-only SQL.";
		case "exec":
			return "Use questdb_exec for writes/DDL after confirmation.";
		case "schema":
			return "Use questdb_schema for CREATE TABLE generation.";
		case "ingest":
			return "Use questdb_ingest for typed ILP publish(row).";
		case "diagnose":
			return "Use questdb_diagnose for cluster health checks.";
		case "docs":
			return "Use questdb_docs for docs lookup.";
	}
}

/**
 * session_start only: hub among QuestDB tools, then additively restore specialists
 * previously enabled via hub (from session branch reconstruction). Never bulk-enables all specialists.
 */
function activateFromSession(piInstance: ExtensionAPI, reconstructedSpecialists: string[] = []): void {
	const hubOnly = computeActiveTools(piInstance.getActiveTools());
	const next =
		reconstructedSpecialists.length > 0
			? mergeToolLists(hubOnly, reconstructedSpecialists)
			: hubOnly;
	piInstance.setActiveTools(next);
}

function summarizeConfig(config: QuestDbRuntimeConfig): string {
	const summary = safeConfigSummary(config);
	return `${summary.baseUrl}${summary.queryPath} • ${summary.readOnly ? "read-only" : "read-write"} • source=${summary.source}`;
}

/** Push compact footer status when a UI is available (TUI/RPC). No-op in print/json. */
function updateQuestDbStatus(
	ctx: Pick<ExtensionContext, "hasUI" | "ui">,
	piInstance: ExtensionAPI,
	config: QuestDbRuntimeConfig = state.config,
): void {
	if (!ctx.hasUI) return;
	const text = formatQuestDbStatusFromConfig(config, piInstance.getActiveTools());
	ctx.ui.setStatus(QUESTDB_STATUS_KEY, text);
}

function clearQuestDbStatus(ctx: Pick<ExtensionContext, "hasUI" | "ui">): void {
	if (!ctx.hasUI) return;
	ctx.ui.setStatus(QUESTDB_STATUS_KEY, undefined);
}

export default function (pi: ExtensionAPI) {
	pi.registerTool({
		name: TOOL_QUERY,
		label: "QuestDB Query",
		description: `Run read-only native QuestDB SQL for exploration (default limit ${DEFAULT_QUESTDB_CONFIG.defaultLimit}; clamped to config.maxLimit, absolute max ${MAX_LIMIT_CEILING}). Use QuestDB syntax, not PostgreSQL syntax.`,
		parameters: QuerySchema,
		async execute(_toolCallId, params, signal, _update, ctx) {
			const statement = splitSingleStatement((params as QueryParams).query);
			const limit = clampLimit(params.limit, state.config);
			return executeWithConfig(statement, state.config, signal, ctx, limit, false);
		},
	});

	pi.registerTool({
		name: TOOL_EXEC,
		label: "QuestDB Exec",
		description: `Execute native QuestDB SQL for writes or DDL after inspecting/querying first; mutations require UI confirmation and read-write mode (default limit ${DEFAULT_QUESTDB_CONFIG.defaultLimit}; clamped to config.maxLimit, absolute max ${MAX_LIMIT_CEILING}).`,
		parameters: QuerySchema,
		async execute(_toolCallId, params, signal, _update, ctx) {
			const statement = splitSingleStatement((params as QueryParams).query);
			const limit = clampLimit(params.limit, state.config);
			return executeWithConfig(statement, state.config, signal, ctx, limit, true);
		},
	});

	pi.registerTool({
		name: TOOL_SCHEMA,
		label: "QuestDB Schema",
		description: "Generate validated QuestDB CREATE TABLE DDL with a designated TIMESTAMP and optional SYMBOL, partition, WAL, and dedup choices.",
		parameters: SchemaToolSchema,
		async execute(_toolCallId, params) {
			const ddl = generateSchemaDdl(params as SchemaToolParams);
			return {
				content: [textContent(ddl)],
				details: { generated: true, tableName: (params as SchemaToolParams).tableName },
			};
		},
	});

	pi.registerTool({
		name: TOOL_INGEST,
		label: "QuestDB Ingest",
		description: "Generate a typed Python ILP sender snippet with explicit timestamp, transport, and protocol choices; use ILP for streaming writes.",
		parameters: IngestToolSchema,
		async execute(_toolCallId, params) {
			const typed = params as IngestToolParams;
			const script = generateIngestScript({
				tableName: typed.tableName,
			timestampColumn: typed.timestampColumn,
			columns: typed.columns,
			host: typed.host,
			port: typed.port,
			transport: typed.transport,
			protocolVersion: typed.protocolVersion,
			timestampExpr: typed.timestampExpr,
		});
			return {
				content: [textContent(script)],
				details: { generated: true, tableName: typed.tableName },
			};
		},
	});

	pi.registerTool({
		name: TOOL_DIAGNOSE,
		label: "QuestDB Diagnose",
		description: `Run a validated QuestDB diagnostic mode (${DIAGNOSTIC_MODES.join(", ")}) for catalog, storage, memory, or activity inspection.`,
		parameters: DiagnosticsToolSchema,
		async execute(_toolCallId, params, signal) {
			const typed = params as DiagnosticsToolParams;
			return runDiagnostics(typed.mode, typed.table, state.config, signal);
		},
	});

	pi.registerTool({
		name: TOOL_DOCS,
		label: "QuestDB Docs",
		description: "Search or fetch official QuestDB documentation; use this syntax fallback instead of guessing PostgreSQL idioms.",
		parameters: DocsToolSchema,
		async execute(_toolCallId, params, signal) {
			return runDocs(params as DocsToolParams, signal);
		},
	});

	pi.registerTool({
		name: TOOL_HUB,
		label: "QuestDB Hub",
		description: "Enable one QuestDB specialist on demand. Start here when QuestDB tools are missing; activation does not change read-only or confirmation policy.",
		promptSnippet: QUESTDB_HUB_SNIPPET,
		promptGuidelines: QUESTDB_HUB_GUIDELINE,
		parameters: HubToolSchema,
		async execute(_toolCallId, params, _signal, _update, ctx) {
			const action = (params as HubToolParams).action;
			if (action === "exec" && state.config.readOnly) {
				throw new Error("questdb_exec is disabled while QuestDB readOnly mode is enabled.");
			}
			const target = hubToolForAction(action);
			state.hasQuestDbContext = true;
			const current = pi.getActiveTools();
			pi.setActiveTools(mergeToolLists(current, [TOOL_HUB, target]));
			updateQuestDbStatus(ctx, pi, state.config);
			return {
				content: [textContent(`Enabled ${target}. ${hubGuidance(action)}\n\n${QUESTDB_NATIVE_GUIDANCE}`)],
				details: { enabled: target },
			};
		},
	});

	pi.registerCommand("questdb", {
		description: "Show QuestDB status and runtime config.",
		handler: async (_args, ctx) => {
			ctx.ui.notify(
				`QuestDB extension\n${summarizeConfig(state.config)}\n` +
					`source: global=${state.hasGlobalConfig ? "yes" : "no"}, project=${state.hasProjectConfig ? "yes" : "no"}, detected=${state.isQuestDbProject ? "yes" : "no"}`,
				"info",
			);
		},
	});

	pi.on("session_start", async (_event, ctx) => {
		const loaded = await loadQuestDbConfig(ctx.cwd, ctx.isProjectTrusted());
		const evidence = await detectQuestDbProjectEvidence(ctx.cwd, ctx.isProjectTrusted());

		// Reconstruct sticky hub activations from the current branch (resume/reload/fork).
		let branch: ReturnType<typeof ctx.sessionManager.getBranch> = [];
		try {
			branch = ctx.sessionManager.getBranch() ?? [];
		} catch {
			branch = [];
		}
		const reconstructed = reconstructSessionActivation(branch, {
			readOnly: loaded.config.readOnly,
			hasProjectEvidence: evidence.hasEvidence,
		});

		state = {
			config: loaded.config,
			hasGlobalConfig: loaded.hasGlobalConfig,
			hasProjectConfig: loaded.hasProjectConfig,
			isQuestDbProject: evidence.hasEvidence,
			hasQuestDbContext: reconstructed.hasQuestDbContext,
		};
		// Hub-only base, then additively restore reconstructed specialists only.
		activateFromSession(pi, reconstructed.enabledSpecialists);
		// Reflect post-activation tools (hub + any reconstructed specialists).
		updateQuestDbStatus(ctx, pi, state.config);
	});

	pi.on("session_shutdown", async (_event, ctx) => {
		clearQuestDbStatus(ctx);
	});

	// Guidance-only: never setActiveTools here. Specialists activate only via hub execute.
	pi.on("before_agent_start", (event) => {
		const prompt = typeof event.prompt === "string" ? event.prompt : "";
		const intent = inferIntentTools(prompt, state.isQuestDbProject || state.hasQuestDbContext);
		if (intent.hasExplicitQuestDbIntent) state.hasQuestDbContext = true;
		if (shouldInjectQuestDbGuidance(state.isQuestDbProject, state.hasQuestDbContext, intent)) {
			return {
				systemPrompt: `${event.systemPrompt}\n\n${QUESTDB_SESSION_GUIDANCE}`,
			};
		}
		return undefined;
	});
}
