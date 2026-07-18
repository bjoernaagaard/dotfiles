import { URL } from "node:url";
import { Buffer } from "node:buffer";
import type { QuestDbMutationResult, QuestDbQueryResult, QuestDbRuntimeConfig } from "./types.ts";

function composeSignal(parent: AbortSignal | undefined, timeoutMs: number): AbortSignal {
	const signals: AbortSignal[] = [];
	if (parent) signals.push(parent);
	if (timeoutMs > 0) signals.push(AbortSignal.timeout(timeoutMs));
	if (signals.length === 0) return new AbortController().signal;
	return signals.length === 1 ? signals[0] : AbortSignal.any(signals);
}

export function toRequestUrl(config: QuestDbRuntimeConfig, query: string, limit?: number): string {
	const url = new URL(config.queryPath, config.baseUrl);
	url.searchParams.set("query", query);
	if (limit !== undefined && Number.isFinite(limit) && limit > 0) {
		url.searchParams.set("limit", String(limit));
	}
	return url.toString();
}

function normalizeColumns(rawColumns: unknown): Array<{ name: string; type: string }> {
	if (!Array.isArray(rawColumns)) {
		return [];
	}

	const columns: Array<{ name: string; type: string }> = [];
	for (const value of rawColumns) {
		if (typeof value === "string") {
			columns.push({ name: value, type: "STRING" });
			continue;
		}
		if (value && typeof value === "object") {
			const candidate = value as { name?: unknown; type?: unknown };
			if (typeof candidate.name === "string" && candidate.name.trim()) {
				columns.push({
					name: candidate.name.trim(),
					type: typeof candidate.type === "string" ? candidate.type.trim() : "STRING",
				});
			}
		}
	}
	return columns;
}

function detectErrorPayload(payload: unknown): string | undefined {
	if (!payload || typeof payload !== "object") {
		return undefined;
	}
	const err = payload as Record<string, unknown>;
	if (typeof err.error === "string" && err.error.trim()) {
		return err.error;
	}
	if (typeof err.message === "string" && err.message.trim()) {
		return err.message;
	}
	if (typeof err.status === "string" && err.status.toLowerCase() === "error") {
		return JSON.stringify(err);
	}
	return undefined;
}

export async function executeQuestDbQuery(
	query: string,
	config: QuestDbRuntimeConfig,
	signal: AbortSignal | undefined,
	limit?: number,
): Promise<QuestDbQueryResult> {
	const requestUrl = toRequestUrl(config, query, limit);
	const requestSignal = composeSignal(signal, config.timeoutMs);

	const headers: Record<string, string> = {
		Accept: "application/json",
	};

	if (config.basicUsername && config.basicPassword) {
		headers.Authorization = `Basic ${Buffer.from(`${config.basicUsername}:${config.basicPassword}`).toString("base64")}`;
	} else if (config.authToken) {
		headers.Authorization = `Bearer ${config.authToken}`;
	}

	let response: Response;
	try {
		response = await fetch(requestUrl, {
			method: "GET",
			signal: requestSignal,
			headers,
		});
	} catch (error: unknown) {
		if ((error as { name?: string }).name === "AbortError") {
			throw new Error("QuestDB request was cancelled or timed out.");
		}
		throw new Error(`QuestDB request failed: ${String((error as Error).message ?? error)}`);
	}

	const payloadText = await response.text();
	let payload: unknown;
	try {
		payload = payloadText ? JSON.parse(payloadText) : null;
	} catch (error: unknown) {
		throw new Error(`QuestDB returned invalid JSON: ${String((error as Error).message ?? error)}`);
	}

	if (!response.ok) {
		const errorMessage = detectErrorPayload(payload) ?? `${response.status} ${response.statusText}`;
		throw new Error(`QuestDB HTTP ${response.status}: ${errorMessage}`);
	}

	const jsonError = detectErrorPayload(payload);
	if (jsonError) {
		throw new Error(`QuestDB error: ${jsonError}`);
	}

	if (!payload || typeof payload !== "object") {
		throw new Error("QuestDB response shape is invalid.");
	}

	const raw = payload as Record<string, unknown>;
	if (raw.ddl !== undefined || raw.updated !== undefined) {
		const ddl = typeof raw.ddl === "string" ? raw.ddl : "";
		const updated = typeof raw.updated === "number" ? raw.updated : 0;
		return {
			kind: "mutation",
			ddl,
			updated,
		};
	}

	if (!Array.isArray(raw.columns) || !Array.isArray(raw.dataset)) {
		throw new Error("QuestDB response shape is missing columns or dataset.");
	}

	const columns = normalizeColumns(raw.columns);
	if (columns.length !== (raw.columns as unknown[]).length) {
		throw new Error("QuestDB response columns could not be normalized.");
	}

	return {
		kind: "select",
		columns,
		dataset: raw.dataset as unknown[][],
	} as QuestDbQueryResult;
}
