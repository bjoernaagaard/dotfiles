import { realpathSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { AbsPath } from "./types.ts";

export function resolveProjectRoot(cwd: string, projectPath?: unknown): AbsPath {
	const base = path.resolve(cwd || ".");
	if (typeof projectPath !== "string" || projectPath.trim() === "") return base;

	let value = projectPath.trim();
	if (value.startsWith("@")) value = value === "@" ? "." : value.slice(1);
	if (value.startsWith("file:")) {
		try {
			return path.resolve(fileURLToPath(value));
		} catch {
			throw new Error("Invalid file URL for CodeGraph project path");
		}
	}
	return path.isAbsolute(value) ? path.resolve(value) : path.resolve(base, value);
}

export function canonicalRoot(cwd: string): AbsPath {
	try {
		return realpathSync(path.resolve(cwd));
	} catch (error) {
		throw new Error(`CodeGraph project root does not exist: ${path.resolve(cwd)}`, { cause: error });
	}
}

export function assertActiveRoot(cwd: string, requested?: unknown): AbsPath {
	const active = canonicalRoot(cwd);
	const resolved = resolveProjectRoot(cwd, requested);
	let candidate: string;
	try {
		candidate = realpathSync(resolved);
	} catch (error) {
		throw new Error("CodeGraph projectPath must resolve to the active project root", { cause: error });
	}
	if (candidate !== active) {
		throw new Error(`CodeGraph projectPath must equal the active project root ${active}`);
	}
	return active;
}

export function projectRelativePath(root: AbsPath, candidate: string): string {
	let raw = candidate.trim();
	if (raw.startsWith("@")) raw = raw === "@" ? "." : raw.slice(1);
	const absolute = path.isAbsolute(raw) ? path.resolve(raw) : path.resolve(root, raw);
	const relative = path.relative(root, absolute);
	if (relative === "" || relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
		throw new Error(`Path must identify a file inside ${root}`);
	}
	return relative.split(path.sep).join("/");
}

export function isWithinRoot(root: AbsPath, candidate: string): boolean {
	const relative = path.relative(path.resolve(root), path.resolve(candidate));
	return relative === "" || (!path.isAbsolute(relative) && relative !== ".." && !relative.startsWith(`..${path.sep}`));
}
