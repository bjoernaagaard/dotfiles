/**
 * Local/cache-only autocomplete helpers for @entity and #run tokens.
 * No network. Pure token/filter logic for unit tests.
 */
import type {
  AutocompleteItem,
  AutocompleteProvider,
  AutocompleteSuggestions,
} from "@earendil-works/pi-tui";
import { fuzzyFilter } from "@earendil-works/pi-tui";
import type { EntityReference } from "../state/entities.ts";

export const MAX_SUGGESTIONS = 20;

const SECRETISH =
  /password|secret|token|api[_-]?key|authorization|bearer\s|eyJ[A-Za-z0-9_-]+\./i;

export function isSafeSuggestionValue(value: string): boolean {
  if (!value || value.length > 200) return false;
  if (/[\s\r\n\x00-\x1f]/.test(value)) return false;
  if (SECRETISH.test(value)) return false;
  return true;
}

/**
 * Extract @token at cursor (start or after whitespace).
 * Returns the partial after `@`, or undefined if not in an @ token.
 */
export function extractAtToken(textBeforeCursor: string): string | undefined {
  const match = textBeforeCursor.match(/(?:^|[ \t])@([^\s@]*)$/);
  return match ? match[1] : undefined;
}

/**
 * Extract #runId token at cursor.
 */
export function extractHashToken(textBeforeCursor: string): string | undefined {
  const match = textBeforeCursor.match(/(?:^|[ \t])#([^\s#]*)$/);
  return match ? match[1] : undefined;
}

export function entityToAtItem(ref: EntityReference): AutocompleteItem | null {
  let value: string;
  if (ref.kind === "asset") {
    value = `@${ref.id}`;
  } else if (ref.kind === "job") {
    value = `@job:${ref.id}`;
  } else if (ref.kind === "location") {
    value = `@location:${ref.id}`;
  } else if (ref.kind === "backfill") {
    value = `@backfill:${ref.id}`;
  } else if (ref.kind === "watch") {
    value = `@watch:${ref.id}`;
  } else {
    // runs use # syntax
    return null;
  }
  if (!isSafeSuggestionValue(value)) return null;
  return {
    value,
    label: value,
    description: ref.description ?? ref.label ?? ref.kind,
  };
}

export function entityToHashItem(ref: EntityReference): AutocompleteItem | null {
  if (ref.kind !== "run") return null;
  const value = `#${ref.id}`;
  if (!isSafeSuggestionValue(value)) return null;
  const desc = [ref.label, ref.description].filter(Boolean).join(" — ") || "run";
  if (SECRETISH.test(desc)) {
    return { value, label: value, description: "run" };
  }
  return { value, label: value, description: desc.slice(0, 80) };
}

export function filterEntitySuggestions(
  refs: EntityReference[],
  trigger: "@" | "#",
  query: string,
  limit = MAX_SUGGESTIONS,
): AutocompleteItem[] {
  const items: AutocompleteItem[] = [];
  for (const ref of refs) {
    const item = trigger === "@" ? entityToAtItem(ref) : entityToHashItem(ref);
    if (item) items.push(item);
  }

  if (!query.trim()) {
    return items.slice(0, limit);
  }

  const filtered = fuzzyFilter(items, query, (item) =>
    `${item.value} ${item.label} ${item.description ?? ""}`,
  );
  return filtered.slice(0, limit);
}

export function createDagsterAutocompleteProvider(
  current: AutocompleteProvider,
  getReferences: () => EntityReference[],
): AutocompleteProvider {
  return {
    triggerCharacters: ["@", "#"],
    async getSuggestions(lines, line, col, options) {
      if (options.signal.aborted) {
        return current.getSuggestions(lines, line, col, options);
      }
      const currentLine = lines[line] ?? "";
      const textBefore = currentLine.slice(0, col);

      const at = extractAtToken(textBefore);
      if (at !== undefined) {
        const items = filterEntitySuggestions(getReferences(), "@", at);
        if (items.length === 0 || options.signal.aborted) {
          return current.getSuggestions(lines, line, col, options);
        }
        return { items, prefix: `@${at}` } satisfies AutocompleteSuggestions;
      }

      const hash = extractHashToken(textBefore);
      if (hash !== undefined) {
        const items = filterEntitySuggestions(getReferences(), "#", hash);
        if (items.length === 0 || options.signal.aborted) {
          return current.getSuggestions(lines, line, col, options);
        }
        return { items, prefix: `#${hash}` } satisfies AutocompleteSuggestions;
      }

      return current.getSuggestions(lines, line, col, options);
    },
    applyCompletion(lines, line, col, item, prefix) {
      return current.applyCompletion(lines, line, col, item, prefix);
    },
    shouldTriggerFileCompletion(lines, line, col) {
      return current.shouldTriggerFileCompletion?.(lines, line, col) ?? true;
    },
  };
}

/** Local command argument completions (no network). */
export function filterPrefix(
  options: string[],
  prefix: string,
): Array<{ value: string; label: string }> {
  const p = prefix.trim().toLowerCase();
  return options
    .filter((o) => o.toLowerCase().startsWith(p) || (p === "" && true))
    .map((value) => ({ value, label: value }));
}

export function completeFromEntities(
  refs: EntityReference[],
  kinds: EntityReference["kind"][],
  prefix: string,
  format: (ref: EntityReference) => string,
): Array<{ value: string; label: string; description?: string }> {
  const p = prefix.trim().toLowerCase();
  const kindSet = new Set(kinds);
  return refs
    .filter((r) => kindSet.has(r.kind))
    .map((r) => {
      const value = format(r);
      return {
        value,
        label: value,
        description: r.description ?? r.label ?? r.kind,
      };
    })
    .filter((i) => isSafeSuggestionValue(i.value))
    .filter((i) => !p || i.value.toLowerCase().includes(p) || (i.description ?? "").toLowerCase().includes(p))
    .slice(0, MAX_SUGGESTIONS);
}
