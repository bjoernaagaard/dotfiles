/**
 * Pure-ish Dagster project / workspace discovery.
 * Existence checks only — no network, no spawning.
 */
import { access, readFile, stat } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";

export type ProjectKind = "project" | "workspace" | "unknown";

export type ProjectDiscovery = {
  root: string;
  kind: ProjectKind;
  markers: string[];
  defsPath?: string;
  dgToml?: string;
  pyproject?: string;
  definitionsPy?: string;
};

async function exists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

async function isDir(path: string): Promise<boolean> {
  try {
    const s = await stat(path);
    return s.isDirectory();
  } catch {
    return false;
  }
}

/**
 * Light string probe for `[tool.dg]` in pyproject.toml (no full TOML parser).
 */
export function pyprojectHasToolDg(content: string): boolean {
  return /\[tool\.dg\]/.test(content);
}

/**
 * Light string probe for workspace-style dg.toml.
 * Vendored docs: `directory_type = "workspace"`.
 */
export function dgTomlLooksLikeWorkspace(content: string): boolean {
  return /directory_type\s*=\s*["']workspace["']/.test(content);
}

type DirScan = {
  dir: string;
  markers: string[];
  dgToml?: string;
  pyproject?: string;
  defsPath?: string;
  definitionsPy?: string;
  hasToolDg: boolean;
  isWorkspaceToml: boolean;
};

async function scanDir(dir: string): Promise<DirScan> {
  const markers: string[] = [];
  let dgToml: string | undefined;
  let pyproject: string | undefined;
  let defsPath: string | undefined;
  let definitionsPy: string | undefined;
  let hasToolDg = false;
  let isWorkspaceToml = false;

  const dgTomlPath = join(dir, "dg.toml");
  if (await exists(dgTomlPath)) {
    markers.push("dg.toml");
    dgToml = dgTomlPath;
    try {
      const text = await readFile(dgTomlPath, "utf8");
      isWorkspaceToml = dgTomlLooksLikeWorkspace(text);
    } catch {
      // ignore read errors
    }
  }

  const pyprojectPath = join(dir, "pyproject.toml");
  if (await exists(pyprojectPath)) {
    markers.push("pyproject.toml");
    pyproject = pyprojectPath;
    try {
      const text = await readFile(pyprojectPath, "utf8");
      hasToolDg = pyprojectHasToolDg(text);
      if (hasToolDg) markers.push("pyproject.toml[tool.dg]");
    } catch {
      // ignore
    }
  }

  const defs = join(dir, "defs");
  if (await isDir(defs)) {
    markers.push("defs/");
    defsPath = defs;
  }

  const definitions = join(dir, "definitions.py");
  if (await exists(definitions)) {
    markers.push("definitions.py");
    definitionsPy = definitions;
  }

  return {
    dir,
    markers,
    dgToml,
    pyproject,
    defsPath,
    definitionsPy,
    hasToolDg,
    isWorkspaceToml,
  };
}

function scoreScan(scan: DirScan): number {
  let score = 0;
  if (scan.dgToml) score += 4;
  if (scan.hasToolDg) score += 3;
  if (scan.defsPath) score += 2;
  if (scan.definitionsPy) score += 2;
  if (scan.pyproject) score += 1;
  if (scan.isWorkspaceToml) score += 1;
  return score;
}

function kindFromScan(scan: DirScan): ProjectKind {
  if (scan.isWorkspaceToml) return "workspace";
  if (scan.dgToml || scan.hasToolDg || scan.defsPath || scan.definitionsPy) {
    return "project";
  }
  return "unknown";
}

/**
 * Walk upward from cwd looking for Dagster project/workspace markers.
 * Returns null when nothing useful is found within the walk.
 */
export async function discoverProject(
  cwd: string,
  options?: { maxDepth?: number },
): Promise<ProjectDiscovery | null> {
  const maxDepth = options?.maxDepth ?? 12;
  let dir = resolve(cwd);
  let best: DirScan | null = null;
  let bestScore = 0;

  for (let depth = 0; depth < maxDepth; depth++) {
    const scan = await scanDir(dir);
    const score = scoreScan(scan);
    if (score > bestScore) {
      best = scan;
      bestScore = score;
    }
    // Strong hit: dg.toml or [tool.dg] at this level — stop.
    if (scan.dgToml || scan.hasToolDg) {
      best = scan;
      break;
    }
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }

  if (!best || bestScore === 0) return null;

  const kind = kindFromScan(best);
  return {
    root: best.dir,
    kind,
    markers: best.markers,
    defsPath: best.defsPath,
    dgToml: best.dgToml,
    pyproject: best.pyproject,
    definitionsPy: best.definitionsPy,
  };
}

/**
 * Prefer profile.projectRoot when it exists; else discover from cwd; else cwd.
 */
export async function resolveProjectRoot(opts: {
  cwd: string;
  profileProjectRoot?: string | null;
}): Promise<{ root: string; discovery: ProjectDiscovery | null }> {
  if (opts.profileProjectRoot) {
    const abs = resolve(opts.profileProjectRoot);
    if (await isDir(abs)) {
      const discovery = await discoverProject(abs);
      return { root: abs, discovery };
    }
  }
  const discovery = await discoverProject(opts.cwd);
  return { root: discovery?.root ?? resolve(opts.cwd), discovery };
}
