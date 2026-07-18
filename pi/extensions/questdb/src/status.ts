import { QUESTDB_TOOL_NAMES } from "./intent.ts";
import type { QuestDbRuntimeConfig } from "./types.ts";

/** Footer status key for ctx.ui.setStatus. */
export const QUESTDB_STATUS_KEY = "questdb";

export type QuestDbStatusInput = {
	baseUrl: string;
	queryPath: string;
	readOnly: boolean;
	/** Current active tool names (may include non-QuestDB tools). */
	activeTools: readonly string[];
};

/**
 * Compact one-line footer status:
 * `QD localhost:9000/exec ro [hub]` or `QD host:9000/exec rw [hub,query,docs]`
 */
export function formatQuestDbStatus(input: QuestDbStatusInput): string {
	const endpoint = formatEndpoint(input.baseUrl, input.queryPath);
	const mode = input.readOnly ? "ro" : "rw";
	const tools = formatActiveQuestDbTools(input.activeTools);
	return `QD ${endpoint} ${mode} [${tools}]`;
}

export function formatQuestDbStatusFromConfig(
	config: Pick<QuestDbRuntimeConfig, "baseUrl" | "queryPath" | "readOnly">,
	activeTools: readonly string[],
): string {
	return formatQuestDbStatus({
		baseUrl: config.baseUrl,
		queryPath: config.queryPath,
		readOnly: config.readOnly,
		activeTools,
	});
}

/** Host[:port]/queryPath — strips protocol for a shorter footer. */
export function formatEndpoint(baseUrl: string, queryPath: string): string {
	const path = normalizePath(queryPath);
	const trimmed = baseUrl.trim().replace(/\/$/, "");
	// Prefer real http(s) URLs. Bare "host:port" is a valid URL with scheme "host:", empty host.
	if (/^https?:\/\//i.test(trimmed)) {
		try {
			const url = new URL(trimmed);
			if (url.host) {
				return `${url.host}${path}`;
			}
		} catch {
			// fall through
		}
	}
	return `${trimmed}${path}`;
}

function normalizePath(queryPath: string): string {
	const trimmed = queryPath.trim() || "/exec";
	return trimmed.startsWith("/") ? trimmed : `/${trimmed}`;
}

/**
 * QuestDB tools only, sorted, with short labels:
 * questdb → hub, questdb_query → query, etc.
 */
export function formatActiveQuestDbTools(activeTools: readonly string[]): string {
	const names = new Set(QUESTDB_TOOL_NAMES as readonly string[]);
	const active = activeTools.filter((name) => names.has(name));
	// Stable display order matching QUESTDB_TOOL_NAMES
	const ordered = (QUESTDB_TOOL_NAMES as readonly string[]).filter((name) => active.includes(name));
	return ordered.map(shortToolLabel).join(",");
}

function shortToolLabel(name: string): string {
	if (name === "questdb") return "hub";
	if (name.startsWith("questdb_")) return name.slice("questdb_".length);
	return name;
}
