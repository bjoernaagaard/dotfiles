export const TOOL_HUB = "questdb";
export const TOOL_QUERY = "questdb_query";
export const TOOL_EXEC = "questdb_exec";
export const TOOL_SCHEMA = "questdb_schema";
export const TOOL_INGEST = "questdb_ingest";
export const TOOL_DIAGNOSE = "questdb_diagnose";
export const TOOL_DOCS = "questdb_docs";

export const QUESTDB_TOOL_NAMES = [
	TOOL_HUB,
	TOOL_QUERY,
	TOOL_EXEC,
	TOOL_SCHEMA,
	TOOL_INGEST,
	TOOL_DIAGNOSE,
	TOOL_DOCS,
] as const;

export const QUESTDB_BASE_TOOLS = [TOOL_HUB] as const;

/** Specialist tools that the hub may enable (excludes hub itself). */
export const QUESTDB_SPECIALIST_TOOLS = [
	TOOL_QUERY,
	TOOL_EXEC,
	TOOL_SCHEMA,
	TOOL_INGEST,
	TOOL_DIAGNOSE,
	TOOL_DOCS,
] as const;

const SPECIALIST_TOOL_SET = new Set<string>(QUESTDB_SPECIALIST_TOOLS);

export interface QuestDbIntentResult {
	forceTools: Set<string>;
	hasExplicitQuestDbIntent: boolean;
}

/** Minimal session-branch entry shape used for reconstruction (avoids hard deps on SessionEntry). */
export type SessionBranchEntryLike = {
	type?: string;
	message?: {
		role?: string;
		toolName?: string;
		isError?: boolean;
		details?: unknown;
	};
};

export interface ReconstructedActivation {
	/** True when any prior hub enablement was found, or sticky project evidence is present. */
	hasQuestDbContext: boolean;
	/** Previously hub-enabled specialists (readOnly-filtered). Sorted, unique. */
	enabledSpecialists: string[];
}

function normalize(prompt: string): string {
	return (prompt || "").toLowerCase();
}

function tokenized(prompt: string): string {
	return normalize(prompt).replace(/[^a-z0-9_]+/g, " ");
}

export function inferIntentTools(prompt: string, questDbContext = false): QuestDbIntentResult {
	const normalized = normalize(prompt);
	const tokens = tokenized(prompt);
	const hasExplicitQuestDb = /\bquest\s*db\b/.test(normalized);
	const forceTools = new Set<string>();

	if (!hasExplicitQuestDb && !questDbContext) {
		return { forceTools, hasExplicitQuestDbIntent: false };
	}

	if (/\bselect\b|\bwith\b|\bshow\b|\bfrom\b|\bwhere\b|\bjoin\b|\blimit\b|\bquery\b/.test(tokens)) {
		forceTools.add(TOOL_QUERY);
	}
	if (/\binsert\b|\bupdate\b|\bdelete\b|\bcreate\b|\balter\b|\bdrop\b|\btruncate\b|\bupsert\b|\bapply\b|\bexecute\b/.test(tokens)) {
		forceTools.add(TOOL_EXEC);
	}
	if (/\bschema\b|\bddl\b|\bdedup\b|\bwal\b|\bpartition\b|\bcolumn\b|\btimestamp\b|\btable\b/.test(tokens)) {
		forceTools.add(TOOL_SCHEMA);
	}
	if (/\bingest\b|\bilp\b|\bsender\b|\bpublish\b|\btcp\b|\bhttp\b/.test(tokens)) {
		forceTools.add(TOOL_INGEST);
	}
	if (/\bdiagnose\b|\bdiagnostic\b|\bstorage\b|\bmemory\b|\bactivity\b|\btrace\b|\btable_columns\b|\btable_partitions\b|\btables\b/.test(tokens)) {
		forceTools.add(TOOL_DIAGNOSE);
	}
	if (/\bdoc\b|\bdocs\b|\bdocumentation\b|\blatest\b|\bsample\b|\btick\b|\bsql\b/.test(tokens)) {
		forceTools.add(TOOL_DOCS);
	}

	return { forceTools, hasExplicitQuestDbIntent: hasExplicitQuestDb };
}

export function getPreferredToolsFromConfig(configTools: string[]): string[] {
	const normalized = configTools.map((name) => name.trim()).filter(Boolean);
	const result = new Set<string>();
	for (const tool of normalized) {
		if (QUESTDB_TOOL_NAMES.includes(tool as (typeof QUESTDB_TOOL_NAMES)[number])) {
			result.add(tool);
		}
	}
	return [...result];
}

/**
 * Hub-only activation among QuestDB tools.
 * Preserves non-QuestDB tools; never bulk-enables specialists.
 * Specialist tools are enabled additively only via the hub tool execute path.
 */
export function computeActiveTools(currentActive: string[]): string[] {
	const nonQuestTools = currentActive.filter(
		(name) => !QUESTDB_TOOL_NAMES.includes(name as (typeof QUESTDB_TOOL_NAMES)[number]),
	);
	return [...new Set([...nonQuestTools, ...QUESTDB_BASE_TOOLS])].sort();
}

/**
 * Additive merge used by the hub to enable one specialist without removing others.
 */
export function mergeToolLists(currentActive: string[], next: string[]): string[] {
	const merged = new Set(currentActive);
	for (const tool of next) {
		merged.add(tool);
	}
	return [...merged].sort();
}

/**
 * Whether project evidence or prompt intent warrants QuestDB system-prompt guidance.
 * Does not activate specialist tools.
 */
export function shouldInjectQuestDbGuidance(
	hasProjectEvidence: boolean,
	hasSessionContext: boolean,
	intent: QuestDbIntentResult,
): boolean {
	return hasProjectEvidence || hasSessionContext || intent.hasExplicitQuestDbIntent;
}

function extractHubEnabledTarget(details: unknown): string | undefined {
	if (!details || typeof details !== "object") return undefined;
	const enabled = (details as { enabled?: unknown }).enabled;
	if (typeof enabled !== "string") return undefined;
	const trimmed = enabled.trim();
	return trimmed || undefined;
}

/**
 * Reconstruct sticky hub activation from a session branch (resume/reload/fork).
 * Scans toolResult messages for hub (`questdb`) results with `details.enabled`.
 * Pure: no setActiveTools side effects. Callers apply the result on session_start only.
 */
export function reconstructSessionActivation(
	branchEntries: readonly SessionBranchEntryLike[],
	options: { readOnly?: boolean; hasProjectEvidence?: boolean } = {},
): ReconstructedActivation {
	const readOnly = options.readOnly ?? true;
	const enabled = new Set<string>();
	let foundHubEnablement = false;

	for (const entry of branchEntries) {
		if (entry?.type !== "message") continue;
		const message = entry.message;
		if (!message || message.role !== "toolResult") continue;
		if (message.toolName !== TOOL_HUB) continue;
		if (message.isError) continue;

		const target = extractHubEnabledTarget(message.details);
		if (!target) continue;

		foundHubEnablement = true;
		if (!SPECIALIST_TOOL_SET.has(target)) continue;
		if (target === TOOL_EXEC && readOnly) continue;
		enabled.add(target);
	}

	return {
		hasQuestDbContext: foundHubEnablement || Boolean(options.hasProjectEvidence),
		enabledSpecialists: [...enabled].sort(),
	};
}
