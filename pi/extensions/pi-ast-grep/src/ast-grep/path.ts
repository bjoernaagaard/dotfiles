import { isAbsolute, relative, resolve, sep } from "node:path";

/** Convert a CLI path to a stable slash-separated path relative to cwd. */
export function normalizeProjectPath(cwd: string, input: string): string {
  const absolute = isAbsolute(input) ? resolve(input) : resolve(cwd, input);
  const normalized = relative(resolve(cwd), absolute).split(sep).join("/");
  return normalized === "" ? "." : normalized;
}

/** Resolve a user target and reject paths outside cwd. */
export function resolveProjectInput(cwd: string, input: string): string {
  if (input.length === 0 || input.includes("\0")) {
    throw new Error("project path must be a non-empty path without NUL bytes");
  }
  const root = resolve(cwd);
  const absolute = resolve(root, input.replace(/^@/u, ""));
  const rel = relative(root, absolute);
  if (rel === ".." || rel.startsWith(`..${sep}`) || isAbsolute(rel)) {
    throw new Error(`path is outside the project cwd: ${input}`);
  }
  return rel === "" ? "." : rel.split(sep).join("/");
}

export function isWithin(root: string, candidate: string): boolean {
  const rel = relative(resolve(root), resolve(candidate));
  return rel === "" || (!isAbsolute(rel) && rel !== ".." && !rel.startsWith(`..${sep}`));
}
