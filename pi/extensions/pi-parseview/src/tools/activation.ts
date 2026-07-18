import path from "node:path";
import { fileURLToPath } from "node:url";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

export const MANAGED_TOOL_NAMES = [
  "parse_document",
  "query_document",
  "screenshot_document",
  "render_diagram",
  "preview_content",
] as const;

export type ManagedToolName = (typeof MANAGED_TOOL_NAMES)[number];
export const LEGACY_TOOL_NAMES = ["mermaid"] as const;

const MANAGED_TOOLS = new Set<string>(MANAGED_TOOL_NAMES);
const OWNED_TOOLS = new Set<string>([...MANAGED_TOOL_NAMES, ...LEGACY_TOOL_NAMES]);
const PACKAGE_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

export const TOOL_DEPENDENCIES: Record<ManagedToolName, readonly ManagedToolName[]> = {
  parse_document: [],
  query_document: ["parse_document"],
  screenshot_document: ["parse_document", "query_document"],
  render_diagram: [],
  preview_content: [],
};

export interface ActivationController {
  activateAdditively(names: Iterable<string>): string[];
  beginTurn(names: Iterable<string>): string[];
  markUsed(name: string): void;
  settle(): void;
  resetForSession(): void;
  setParserAvailable(available: boolean): void;
  shutdown(): void;
}

interface ToolMetadata {
  name: string;
  sourceInfo?: { path?: string; source?: string };
}

export function createActivationController(pi: ExtensionAPI): ActivationController {
  let parserAvailable = true;
  let generation = 0;
  const leases = new Map<string, { root: ManagedToolName; closure: Set<ManagedToolName> }>();
  const activatedByUs = new Set<ManagedToolName>();

  const getAllTools = (): ToolMetadata[] => {
    try {
      return (pi.getAllTools?.() ?? []) as ToolMetadata[];
    } catch {
      return [];
    }
  };

  const definitionIsOurs = (name: string): boolean => {
    const definition = getAllTools()
      .filter((tool) => tool.name === name)
      .at(-1);
    if (!definition) return false;
    const sourceInfo = definition.sourceInfo;
    if (!sourceInfo) return true;
    if (sourceInfo.source === "builtin" || sourceInfo.source === "sdk") return false;

    const source = `${sourceInfo.source ?? ""} ${sourceInfo.path ?? ""}`;
    if (/pi-parseview|@juvio15\/pi-parseview/i.test(source)) return true;
    if (sourceInfo.path && path.isAbsolute(sourceInfo.path)) {
      const relative = path.relative(PACKAGE_ROOT, sourceInfo.path);
      return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
    }
    return false;
  };

  const isAvailable = (name: ManagedToolName): boolean =>
    parserAvailable ||
    (!name.startsWith("parse_") && name !== "query_document" && name !== "screenshot_document");

  const dependencyClosure = (names: Iterable<string>): Set<ManagedToolName> => {
    const closure = new Set<ManagedToolName>();
    const visit = (name: ManagedToolName) => {
      if (closure.has(name) || !isAvailable(name) || !definitionIsOurs(name)) return;
      for (const dependency of TOOL_DEPENDENCIES[name]) visit(dependency);
      closure.add(name);
    };
    for (const name of names) {
      if (MANAGED_TOOLS.has(name)) visit(name as ManagedToolName);
    }
    return closure;
  };

  const activateAdditively = (names: Iterable<string>): string[] => {
    const requested = dependencyClosure(names);
    if (requested.size === 0) return [];

    const current = pi.getActiveTools();
    const added = [...requested].filter((name) => !current.includes(name));
    if (added.length === 0) return [];

    // Dynamic loading is detected only for purely additive transitions.
    pi.setActiveTools([...new Set([...current, ...added])]);
    for (const name of added) activatedByUs.add(name);
    return added;
  };

  const retainedClosure = (): Set<ManagedToolName> => {
    const retained = new Set<ManagedToolName>();
    for (const lease of leases.values()) {
      for (const name of lease.closure) retained.add(name);
    }
    return retained;
  };

  const deactivateUnretained = (): void => {
    const retained = retainedClosure();
    const current = pi.getActiveTools();
    const candidates = new Set(
      [...activatedByUs].filter((name) => current.includes(name) && !retained.has(name)),
    );

    const removable = [...candidates].filter((name) => {
      return !(Object.keys(TOOL_DEPENDENCIES) as ManagedToolName[]).some(
        (dependent) =>
          current.includes(dependent) &&
          !candidates.has(dependent) &&
          TOOL_DEPENDENCIES[dependent].includes(name),
      );
    });
    if (removable.length === 0) return;

    const removableSet = new Set<string>(removable);
    pi.setActiveTools(current.filter((name) => !removableSet.has(name)));
    for (const name of removable) activatedByUs.delete(name);
  };

  return {
    activateAdditively,
    beginTurn(names) {
      generation += 1;
      leases.clear();
      for (const rootName of names) {
        if (!MANAGED_TOOLS.has(rootName)) continue;
        const root = rootName as ManagedToolName;
        const closure = dependencyClosure([root]);
        if (closure.size > 0) leases.set(`${generation}:${root}`, { root, closure });
      }
      return activateAdditively(names);
    },
    markUsed(name) {
      if (!MANAGED_TOOLS.has(name)) return;
      const root = name as ManagedToolName;
      const closure = dependencyClosure([root]);
      if (closure.size > 0) leases.set(`${generation}:used:${root}`, { root, closure });
    },
    settle() {
      leases.clear();
      deactivateUnretained();
    },
    resetForSession() {
      generation = 0;
      leases.clear();
      activatedByUs.clear();
      const current = pi.getActiveTools();
      const filtered = current.filter((name) => !OWNED_TOOLS.has(name) || !definitionIsOurs(name));
      if (filtered.length !== current.length) pi.setActiveTools(filtered);
    },
    setParserAvailable(available) {
      parserAvailable = available;
      if (!available) {
        leases.forEach((lease, key) => {
          if ([...lease.closure].some((name) => !isAvailable(name))) leases.delete(key);
        });
        deactivateUnretained();
      }
    },
    shutdown() {
      leases.clear();
      activatedByUs.clear();
    },
  };
}
