import path from "node:path";
import { canonicalRoot, isWithinRoot, projectRelativePath } from "./paths.ts";
import type { FilesMutatedEvent } from "./types.ts";

export const FILES_MUTATED_EVENT = "pi:files-mutated:v1";

export function parseFilesMutatedEvent(value: unknown): FilesMutatedEvent {
	if (!isRecord(value)) throw new Error("mutation event must be an object");
	if (value.schemaVersion !== 1) throw new Error("unsupported mutation event schema");
	if (typeof value.source !== "string" || value.source.trim() === "") throw new Error("mutation event source is required");
	if (typeof value.projectRoot !== "string" || !path.isAbsolute(value.projectRoot)) throw new Error("mutation event root must be absolute");
	const inputRoot = path.resolve(value.projectRoot);
	const root = canonicalRoot(inputRoot);
	if (typeof value.emittedAt !== "string" || !Number.isFinite(Date.parse(value.emittedAt))) throw new Error("invalid mutation timestamp");
	if (!Array.isArray(value.paths)) throw new Error("mutation event paths must be an array");

	const paths = value.paths.map((entry) => {
		if (typeof entry !== "string" || entry.trim() === "") throw new Error("mutation paths must be non-empty strings");
		return projectRelativePath(root, entry);
	});
	if (new Set(paths).size !== paths.length) throw new Error("mutation paths must be unique");
	if (!same(paths, [...paths].sort())) throw new Error("mutation paths must be sorted");

	let canonicalPaths: string[] | undefined;
	if (value.canonicalPaths !== undefined) {
		if (!Array.isArray(value.canonicalPaths) || value.canonicalPaths.length !== paths.length) {
			throw new Error("mutation canonical paths must correspond to paths");
		}
		canonicalPaths = value.canonicalPaths.map((entry, index) => {
			if (typeof entry !== "string" || !path.isAbsolute(entry) || path.resolve(entry) !== entry || !isWithinRoot(inputRoot, entry)) {
				throw new Error("mutation canonical path must stay inside root");
			}
			const relative = path.relative(inputRoot, entry).split(path.sep).join("/");
			if (relative !== paths[index]) throw new Error("mutation path pairs do not match");
			return path.resolve(root, relative);
		});
	}

	for (const key of ["transactionId", "operation", "state"] as const) {
		if (value[key] !== undefined && typeof value[key] !== "string") throw new Error(`mutation ${key} must be a string`);
	}

	return {
		schemaVersion: 1,
		source: value.source,
		projectRoot: root,
		paths,
		canonicalPaths,
		transactionId: value.transactionId as string | undefined,
		operation: value.operation as string | undefined,
		state: value.state as string | undefined,
		emittedAt: new Date(value.emittedAt).toISOString(),
	};
}

export function mutationId(event: FilesMutatedEvent): string {
	return event.transactionId ?? `${event.source}-${event.emittedAt}`;
}

function same(left: readonly string[], right: readonly string[]): boolean {
	return left.length === right.length && left.every((value, index) => value === right[index]);
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}
