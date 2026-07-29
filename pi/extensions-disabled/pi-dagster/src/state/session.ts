/**
 * Pure helpers for reconstructing session state from the Pi branch.
 * Tool result `details` is the stable replay record (proposal §4.3 / §7.1).
 */

export type BranchToolResultMessage = {
  role: string;
  toolName?: string;
  details?: unknown;
  addedToolNames?: string[];
};

export type BranchEntry = {
  type: string;
  message?: BranchToolResultMessage;
  customType?: string;
  data?: unknown;
  details?: unknown;
  summary?: string;
};

export type LoaderDetails = {
  matches?: string[];
  added?: string[];
  activeProfile?: string | null;
};

const LOADER_TOOL = "dagster_search_tools";

/**
 * Walk branch in order and collect the union of loader `details.added`
 * (and accept top-level `addedToolNames` as corroborating metadata).
 */
export function extractPreviouslyLoadedFromBranch(
  entries: readonly BranchEntry[],
  loaderToolName: string = LOADER_TOOL,
): string[] {
  const loaded: string[] = [];
  const seen = new Set<string>();

  for (const entry of entries) {
    if (entry.type !== "message" || !entry.message) continue;
    const msg = entry.message;
    if (msg.role !== "toolResult" || msg.toolName !== loaderToolName) continue;

    const fromDetails = asStringArray((msg.details as LoaderDetails | undefined)?.added);
    const fromTop = asStringArray(msg.addedToolNames);
    for (const name of [...fromDetails, ...fromTop]) {
      if (!seen.has(name)) {
        seen.add(name);
        loaded.push(name);
      }
    }
  }

  return loaded;
}

/**
 * Last non-null active profile recorded in loader/status tool details, if any.
 */
export function extractActiveProfileFromBranch(entries: readonly BranchEntry[]): string | null {
  let active: string | null = null;
  for (const entry of entries) {
    if (entry.type === "message" && entry.message?.role === "toolResult") {
      const details = entry.message.details as LoaderDetails | undefined;
      if (details && "activeProfile" in details) {
        active = details.activeProfile ?? null;
      }
      continue;
    }
    if (entry.type === "custom" && entry.customType === "dagster.incident") {
      const data = entry.data as { profileName?: unknown } | undefined;
      if (typeof data?.profileName === "string" && data.profileName) active = data.profileName;
    }
    if (entry.type === "custom_message" && entry.customType === "dagster.incident") {
      const details = entry.details as { profileName?: unknown } | undefined;
      if (typeof details?.profileName === "string" && details.profileName) active = details.profileName;
    }
    if (entry.type === "compaction") {
      const dagster = (entry.details as { dagster?: { profileName?: unknown; incident?: { profileName?: unknown } } } | undefined)
        ?.dagster;
      const fromIncident = dagster?.incident?.profileName;
      const fromFlat = dagster?.profileName;
      if (typeof fromIncident === "string" && fromIncident) active = fromIncident;
      else if (typeof fromFlat === "string" && fromFlat) active = fromFlat;
    }
  }
  return active;
}

function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((v): v is string => typeof v === "string");
}

/**
 * session_start active-set algorithm (proposal §4.3):
 * preserve foreign tools + builtins we don't own, drop searchable, ensure always-on,
 * re-add previously loaded searchable tools.
 */
export function computeSessionStartActiveTools(input: {
  current: readonly string[];
  alwaysOn: readonly string[];
  searchable: ReadonlySet<string>;
  previouslyLoaded: readonly string[];
}): string[] {
  const { current, alwaysOn, searchable, previouslyLoaded } = input;
  const preservedForeignAndAlways = current.filter((n) => !searchable.has(n));
  const restored = previouslyLoaded.filter((n) => searchable.has(n));
  return [...new Set([...preservedForeignAndAlways, ...alwaysOn, ...restored])];
}

/**
 * Additive-only loader activation: never remove currently active tools.
 */
export function computeAdditiveActiveTools(
  current: readonly string[],
  matches: readonly string[],
): { next: string[]; added: string[] } {
  const active = [...current];
  const added = matches.filter((n) => !active.includes(n));
  const next = [...new Set([...active, ...added])];
  return { next, added };
}
