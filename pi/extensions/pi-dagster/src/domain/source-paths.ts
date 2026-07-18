/**
 * Path helpers under a Dagster project root.
 * Used by scaffold wrappers and tool-native authoring guidance — never hand-roll
 * project layouts here.
 */
import { isAbsolute, join, normalize, relative, resolve, sep } from "node:path";

/**
 * Resolve a user path under projectRoot.
 * - Relative paths resolve under projectRoot.
 * - Absolute paths must still fall under projectRoot (after normalize).
 * Rejects `..` escapes outside the project root.
 */
export function resolveUnderProject(projectRoot: string, userPath: string): string {
  const root = resolve(projectRoot);
  const candidate = isAbsolute(userPath)
    ? resolve(userPath)
    : resolve(root, userPath);
  const normalized = normalize(candidate);

  const rel = relative(root, normalized);
  if (rel === "") return root;
  if (rel.startsWith(`..${sep}`) || rel === ".." || isAbsolute(rel)) {
    throw new Error(
      `Path escapes project root: ${userPath} (root=${root})`,
    );
  }
  return normalized;
}

/** Conventional defs/ directory under project root. */
export function defsDir(projectRoot: string): string {
  return join(resolve(projectRoot), "defs");
}

/** definitions.py under project root (may not exist). */
export function definitionsPyPath(projectRoot: string): string {
  return join(resolve(projectRoot), "definitions.py");
}

/** dg.toml under project root (may not exist). */
export function dgTomlPath(projectRoot: string): string {
  return join(resolve(projectRoot), "dg.toml");
}

/**
 * Resolve a component / def path relative to defs/ when relative.
 */
export function resolveDefsPath(projectRoot: string, userPath: string): string {
  if (isAbsolute(userPath)) {
    return resolveUnderProject(projectRoot, userPath);
  }
  // If user already prefixes with defs/, resolve under root; else under defs/.
  const cleaned = userPath.replace(/^\.\/+/, "");
  if (cleaned === "defs" || cleaned.startsWith(`defs${sep}`) || cleaned.startsWith("defs/")) {
    return resolveUnderProject(projectRoot, cleaned);
  }
  return resolveUnderProject(defsDir(projectRoot), cleaned);
}
