import { access, readFile } from "node:fs/promises";
import { join } from "node:path";
import { CONFIG_DIR_NAME } from "@earendil-works/pi-coding-agent";

const DEPENDENCY_FILES = [
	"package.json",
	"requirements.txt",
	"pyproject.toml",
	"Pipfile",
	"poetry.lock",
	"Cargo.toml",
	"go.mod",
	"build.gradle",
	"build.gradle.kts",
	"pom.xml",
	"gradle.properties",
] as const;

const QUESTDB_SIGNALS = [
	"questdb",
	"io.questdb",
	"@questdb/",
	"questdb-client",
	"questdb-ingress",
] as const;

function isLikelyQuestDbText(text: string): boolean {
	const normalized = text.toLowerCase();
	return QUESTDB_SIGNALS.some((signal) => normalized.includes(signal));
}

async function fileExists(path: string): Promise<boolean> {
	try {
		await access(path);
		return true;
	} catch {
		return false;
	}
}

async function readIfExists(path: string): Promise<string | undefined> {
	try {
		return await readFile(path, "utf-8");
	} catch {
		return undefined;
	}
}

function normalizeDependencyObjectValue(obj: unknown): string[] {
	if (!obj || typeof obj !== "object" || Array.isArray(obj)) {
		return [];
	}

	const entries = Object.entries(obj);
	return entries.map(([name]) => name);
}

async function inspectPackageJson(path: string): Promise<boolean> {
	const text = await readIfExists(path);
	if (!text) return false;
	if (!isLikelyQuestDbText(text)) return false;

	try {
		const parsed = JSON.parse(text);
		if (!parsed || typeof parsed !== "object") return false;
		const deps = normalizeDependencyObjectValue(parsed.dependencies);
		const devDeps = normalizeDependencyObjectValue(parsed.devDependencies);
		const peers = normalizeDependencyObjectValue(parsed.optionalDependencies);
		const all = [...deps, ...devDeps, ...peers].map((name) => name.toLowerCase());
		return all.some((name) => isLikelyQuestDbText(name));
	} catch {
		// Fallback to text mode for unusual package formats.
		return isLikelyQuestDbText(text);
	}
}

async function inspectDependencyFile(path: string): Promise<boolean> {
	const text = await readIfExists(path);
	if (!text) return false;
	return isLikelyQuestDbText(text);
}

export interface QuestDbProjectEvidence {
	hasEvidence: boolean;
	path?: string;
}

export async function detectQuestDbProjectEvidence(cwd: string, trustedProject: boolean): Promise<QuestDbProjectEvidence> {
	if (!trustedProject) {
		return { hasEvidence: false };
	}

	const explicitPath = join(cwd, CONFIG_DIR_NAME, "questdb.json");
	if (await fileExists(explicitPath)) {
		return { hasEvidence: true, path: explicitPath };
	}

	for (const file of DEPENDENCY_FILES) {
		const fullPath = join(cwd, file);
		if (!(await fileExists(fullPath))) {
			continue;
		}

		const matches = file === "package.json"
			? await inspectPackageJson(fullPath)
			: await inspectDependencyFile(fullPath);
		if (matches) {
			return { hasEvidence: true, path: fullPath };
		}
	}

	return { hasEvidence: false };
}
