import { access, readFile } from "node:fs/promises";
import { join } from "node:path";
import { CONFIG_DIR_NAME, getAgentDir } from "@earendil-works/pi-coding-agent";
import type { LoadedQuestDbConfig, QuestDbConfigFile, QuestDbRuntimeConfig, QuestDbConfigSource } from "./types.ts";

const boolYes = new Set(["1", "true", "yes", "on", "y", "enabled"]);
const boolNo = new Set(["0", "false", "no", "off", "n", "disabled"]);

/** Default config.maxLimit when unset. */
export const DEFAULT_MAX_LIMIT = 1_000;

/** Absolute hard ceiling for query row limits — shared by QuerySchema and clampLimit. */
export const MAX_LIMIT_CEILING = 200_000;

export const DEFAULT_QUESTDB_CONFIG: QuestDbRuntimeConfig = {
	baseUrl: "http://localhost:9000",
	queryPath: "/exec",
	timeoutMs: 10_000,
	defaultLimit: 200,
	maxLimit: DEFAULT_MAX_LIMIT,
	readOnly: true,
	preferredTools: [],
	source: "default",
};

function toBoolean(raw: string | undefined): boolean | undefined {
	if (!raw) return undefined;
	const normalized = raw.trim().toLowerCase();
	if (boolYes.has(normalized)) return true;
	if (boolNo.has(normalized)) return false;
	return undefined;
}

function toNumber(raw: string | undefined): number | undefined {
	if (!raw) return undefined;
	const value = Number.parseInt(raw, 10);
	if (!Number.isFinite(value) || value < 0) {
		return undefined;
	}
	return value;
}

function cleanPreferredTools(raw: unknown): string[] {
	if (!Array.isArray(raw)) {
		return [];
	}

	const out: string[] = [];
	for (const item of raw) {
		if (typeof item === "string") {
			const trimmed = item.trim();
			if (trimmed) {
				out.push(trimmed);
			}
		}
	}
	return out;
}

async function readJsonConfig(path: string): Promise<QuestDbConfigFile | undefined> {
	try {
		await access(path);
		const content = await readFile(path, "utf-8");
		const parsed = JSON.parse(content);
		if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
			return undefined;
		}
		return parsed as QuestDbConfigFile;
	} catch {
		return undefined;
	}
}

function applyConfig(
	base: QuestDbRuntimeConfig,
	next: Partial<QuestDbConfigFile & {
		baseUrl?: string;
		readOnly?: boolean;
		timeoutMs?: number;
		defaultLimit?: number;
		maxLimit?: number;
		preferredTools?: string[];
		queryPath?: string;
	}>,
	source: QuestDbConfigSource,
): QuestDbRuntimeConfig {
	const out: QuestDbRuntimeConfig = {
		...base,
		source,
	};

	if (typeof next.baseUrl === "string" && next.baseUrl.trim()) {
		out.baseUrl = next.baseUrl.trim().replace(/\/$/, "");
	}
	if (typeof next.queryPath === "string" && next.queryPath.trim()) {
		out.queryPath = next.queryPath.trim().startsWith("/") ? next.queryPath.trim() : `/${next.queryPath.trim()}`;
	}
	if (typeof next.timeoutMs === "number" && Number.isFinite(next.timeoutMs) && next.timeoutMs > 0) {
		out.timeoutMs = next.timeoutMs;
	}
	if (typeof next.defaultLimit === "number" && Number.isFinite(next.defaultLimit) && next.defaultLimit > 0) {
		out.defaultLimit = next.defaultLimit;
	}
	if (typeof next.maxLimit === "number" && Number.isFinite(next.maxLimit) && next.maxLimit > 0) {
		out.maxLimit = Math.min(Math.floor(next.maxLimit), MAX_LIMIT_CEILING);
	}
	if (typeof next.readOnly === "boolean") {
		out.readOnly = next.readOnly;
	}
	if (Array.isArray(next.preferredTools)) {
		out.preferredTools = cleanPreferredTools(next.preferredTools);
	}

	if (out.maxLimit > MAX_LIMIT_CEILING) {
		out.maxLimit = MAX_LIMIT_CEILING;
	}
	if (out.maxLimit < out.defaultLimit) {
		out.defaultLimit = out.maxLimit;
	}

	return out;
}

function parseEnvOverrides(): Partial<QuestDbRuntimeConfig> & {
	source: QuestDbConfigSource;
	envProvided: boolean;
	} {
	const baseUrl = process.env.QUESTDB_BASE_URL?.trim();
	const queryPath = process.env.QUESTDB_QUERY_PATH?.trim();
	const timeoutMs = toNumber(process.env.QUESTDB_TIMEOUT_MS) ?? toNumber(process.env.QUESTDB_QUERY_TIMEOUT_MS);
	const defaultLimit = toNumber(process.env.QUESTDB_DEFAULT_LIMIT);
	const maxLimit = toNumber(process.env.QUESTDB_MAX_LIMIT);
	const readOnly = toBoolean(process.env.QUESTDB_READ_ONLY);
	const envProvided = Boolean(
		process.env.QUESTDB_BASE_URL ||
			process.env.QUESTDB_QUERY_PATH ||
			process.env.QUESTDB_TIMEOUT_MS ||
			process.env.QUESTDB_QUERY_TIMEOUT_MS ||
			process.env.QUESTDB_DEFAULT_LIMIT ||
			process.env.QUESTDB_MAX_LIMIT ||
			process.env.QUESTDB_READ_ONLY !== undefined ||
			process.env.QUESTDB_PREFERRED_TOOLS ||
			process.env.QUESTDB_TOKEN ||
			process.env.QUESTDB_API_TOKEN ||
			process.env.QUESTDB_USERNAME ||
			process.env.QUESTDB_PASSWORD,
	);

	const preferredTools = process.env.QUESTDB_PREFERRED_TOOLS
		?.split(",")
		.map((tool) => tool.trim())
		.filter(Boolean);

	return {
		baseUrl,
		queryPath,
		timeoutMs,
		defaultLimit,
		maxLimit,
		readOnly,
		preferredTools: cleanPreferredTools(preferredTools),
		authToken: process.env.QUESTDB_TOKEN?.trim() || process.env.QUESTDB_API_TOKEN?.trim(),
		basicUsername: process.env.QUESTDB_USERNAME?.trim(),
		basicPassword: process.env.QUESTDB_PASSWORD?.trim(),
		source: "env",
		envProvided,
	};
}

export async function loadQuestDbConfig(cwd: string, trustedProject: boolean): Promise<LoadedQuestDbConfig> {
	const globalPath = join(getAgentDir(), "questdb.json");
	const projectPath = join(cwd, CONFIG_DIR_NAME, "questdb.json");

	let hasGlobalConfig = false;
	let hasProjectConfig = false;
	let fileConfig: QuestDbConfigFile = {};

	const globalConfig = await readJsonConfig(globalPath);
	if (globalConfig) {
		fileConfig = { ...fileConfig, ...globalConfig };
		hasGlobalConfig = true;
	}

	if (trustedProject) {
		const cwdConfig = await readJsonConfig(projectPath);
		if (cwdConfig) {
			fileConfig = { ...fileConfig, ...cwdConfig };
			hasProjectConfig = true;
		}
	}

	let result = applyConfig(
		{ ...DEFAULT_QUESTDB_CONFIG, source: hasProjectConfig ? "project" : hasGlobalConfig ? "global" : "default" },
		fileConfig,
		hasProjectConfig ? "project" : hasGlobalConfig ? "global" : "default",
	);

	const envConfig = parseEnvOverrides();
	if (envConfig.envProvided) {
		result = applyConfig(
			result,
			envConfig,
			"env",
		);

		if (typeof envConfig.authToken === "string" && envConfig.authToken) {
			result.authToken = envConfig.authToken;
		}
		if (envConfig.basicUsername) {
			result.basicUsername = envConfig.basicUsername;
		}
		if (envConfig.basicPassword) {
			result.basicPassword = envConfig.basicPassword;
		}
		result.source = "env";
	}

	if (!result.baseUrl.toLowerCase().startsWith("http://") && !result.baseUrl.toLowerCase().startsWith("https://")) {
		result.baseUrl = `http://${result.baseUrl}`;
	}

	return {
		config: result,
		hasGlobalConfig,
		hasProjectConfig,
	};
}

export function redactSecret(value: string | undefined): string {
	if (!value) {
		return "(unset)";
	}
	return "***REDACTED***";
}

export function safeConfigSummary(config: QuestDbRuntimeConfig): Omit<QuestDbRuntimeConfig, "authToken" | "basicPassword"> & { basicUsername?: string; basicPassword?: string } {
	return {
		baseUrl: config.baseUrl,
		queryPath: config.queryPath,
		timeoutMs: config.timeoutMs,
		defaultLimit: config.defaultLimit,
		maxLimit: config.maxLimit,
		readOnly: config.readOnly,
		preferredTools: config.preferredTools,
		source: config.source,
		basicUsername: redactSecret(config.basicUsername),
		basicPassword: redactSecret(config.basicPassword),
	};
}

export function getQueryUrl(config: QuestDbRuntimeConfig): string {
	return `${config.baseUrl}${config.queryPath}`;
}

/**
 * Resolve an effective row limit: defaults to config.defaultLimit, floors to int,
 * and clamps into [1, min(config.maxLimit, MAX_LIMIT_CEILING)].
 */
export function clampLimit(value: number | undefined, config: QuestDbRuntimeConfig): number {
	const requested = value ?? config.defaultLimit;
	if (!Number.isFinite(requested)) {
		return config.defaultLimit;
	}
	const effectiveMax = Math.min(config.maxLimit, MAX_LIMIT_CEILING);
	return Math.max(1, Math.min(effectiveMax, Math.floor(requested)));
}
