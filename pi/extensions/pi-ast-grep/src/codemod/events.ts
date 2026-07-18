import { isAbsolute, relative, resolve, sep } from "node:path";
import type { FilesMutatedEvent } from "../domain.js";
import { resolveProjectInput } from "../ast-grep/path.js";

export const FILES_MUTATED_EVENT = "pi:files-mutated:v1";

/** Empty paths intentionally mean conservative same-root invalidation. */
export function createFilesMutatedEvent(
  projectRoot: string,
  paths: readonly string[] = [],
  now = new Date(),
): FilesMutatedEvent {
  const root = resolve(projectRoot);
  const normalized = [...new Set(paths.map((path) => resolveProjectInput(root, path)))]
    .filter((path) => path !== ".")
    .sort();
  const event: FilesMutatedEvent = {
    schemaVersion: 1,
    source: "pi-ast-grep",
    projectRoot: root,
    operation: "apply",
    state: "applied",
    paths: normalized,
    canonicalPaths: normalized.map((path) => resolve(root, path)),
    emittedAt: now.toISOString(),
  };
  assertFilesMutatedEvent(event);
  return Object.freeze({
    ...event,
    paths: Object.freeze([...event.paths]),
    canonicalPaths: Object.freeze([...event.canonicalPaths]),
  });
}

export function assertFilesMutatedEvent(value: unknown): asserts value is FilesMutatedEvent {
  if (!isRecord(value)) throw new Error("mutation event must be an object");
  const expected = ["schemaVersion", "source", "projectRoot", "operation", "state", "paths", "canonicalPaths", "emittedAt"];
  if (Object.keys(value).length !== expected.length || expected.some((key) => !(key in value))) {
    throw new Error("mutation event has invalid fields");
  }
  if (value.schemaVersion !== 1 || value.source !== "pi-ast-grep") throw new Error("unsupported mutation event protocol");
  if (typeof value.projectRoot !== "string" || !isAbsolute(value.projectRoot) || resolve(value.projectRoot) !== value.projectRoot) {
    throw new Error("mutation event root is not canonical");
  }
  if (value.operation !== "apply" || value.state !== "applied") throw new Error("invalid mutation operation or state");
  if (typeof value.emittedAt !== "string" || !Number.isFinite(Date.parse(value.emittedAt)) || new Date(value.emittedAt).toISOString() !== value.emittedAt) {
    throw new Error("invalid mutation timestamp");
  }
  if (!Array.isArray(value.paths) || !Array.isArray(value.canonicalPaths) || value.paths.length !== value.canonicalPaths.length) {
    throw new Error("invalid mutation paths");
  }
  const paths = value.paths as unknown[];
  const canonical = value.canonicalPaths as unknown[];
  if (paths.some((path) => typeof path !== "string" || path.length === 0 || isAbsolute(path) || path === ".." || path.startsWith(`..${sep}`))) {
    throw new Error("mutation paths must be project-relative");
  }
  if (canonical.some((path) => typeof path !== "string" || !isAbsolute(path) || resolve(path) !== path || !isWithin(value.projectRoot as string, path))) {
    throw new Error("mutation canonical paths must stay inside root");
  }
  if (new Set(paths).size !== paths.length || new Set(canonical).size !== canonical.length) throw new Error("mutation paths must be unique");
  if (!same(paths as string[], [...paths as string[]].sort())) throw new Error("mutation paths must be sorted");
}

function isWithin(root: string, candidate: string): boolean {
  const rel = relative(resolve(root), resolve(candidate));
  return rel === "" || (!isAbsolute(rel) && rel !== ".." && !rel.startsWith(`..${sep}`));
}

function same(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
