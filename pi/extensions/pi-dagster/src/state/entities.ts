/**
 * Bounded entity-reference cache for autocomplete and context.
 * No raw run config/tags/logs/secrets.
 */

export type EntityKind =
  | "asset"
  | "job"
  | "run"
  | "location"
  | "backfill"
  | "watch"
  | "schedule"
  | "sensor";

export type EntityReference = {
  kind: EntityKind | string;
  id: string;
  label?: string;
  description?: string;
  /** Monotonic recency (higher = more recent). */
  seenAt: number;
};

const MAX_TOTAL = 100;
const MAX_PER_KIND = 30;
/** getRecentEntities compatibility bound for get_context. */
export const RECENT_ENTITIES_LIMIT = 3;

const SECRETISH =
  /password|secret|token|api[_-]?key|authorization|bearer\s|eyJ[A-Za-z0-9_-]+\./i;

export function isSafeEntityId(id: string): boolean {
  if (!id || typeof id !== "string") return false;
  if (id.length > 200) return false;
  if (/[\r\n\x00-\x08\x0b\x0c\x0e-\x1f]/.test(id)) return false;
  if (SECRETISH.test(id)) return false;
  return true;
}

export function createEntityCache() {
  let seq = 0;
  let items: EntityReference[] = [];

  function rememberEntity(
    kind: string,
    id: string,
    metadata?: { label?: string; description?: string },
  ): void {
    const trimmedId = id?.trim?.() ?? String(id ?? "");
    if (!isSafeEntityId(trimmedId)) return;
    const kindKey = (kind || "unknown").trim() || "unknown";
    if (SECRETISH.test(kindKey)) return;

    const label =
      metadata?.label && !SECRETISH.test(metadata.label)
        ? metadata.label.slice(0, 120)
        : undefined;
    const description =
      metadata?.description && !SECRETISH.test(metadata.description)
        ? metadata.description.slice(0, 160)
        : undefined;

    seq += 1;
    items = [
      {
        kind: kindKey,
        id: trimmedId,
        label,
        description,
        seenAt: seq,
      },
      ...items.filter((e) => !(e.kind === kindKey && e.id === trimmedId)),
    ];

    // Per-kind bound
    const byKind = new Map<string, number>();
    const next: EntityReference[] = [];
    for (const e of items) {
      const n = byKind.get(e.kind) ?? 0;
      if (n >= MAX_PER_KIND) continue;
      byKind.set(e.kind, n + 1);
      next.push(e);
      if (next.length >= MAX_TOTAL) break;
    }
    items = next;
  }

  function getEntityReferences(options?: {
    kinds?: string[];
    limit?: number;
  }): EntityReference[] {
    const kindFilter = options?.kinds?.length ? new Set(options.kinds) : null;
    const limit = Math.min(Math.max(options?.limit ?? MAX_TOTAL, 1), MAX_TOTAL);
    return items
      .filter((e) => !kindFilter || kindFilter.has(e.kind))
      .slice(0, limit)
      .map((e) => ({ ...e }));
  }

  function getRecentEntities(): Array<{ kind: string; id: string }> {
    return items.slice(0, RECENT_ENTITIES_LIMIT).map((e) => ({
      kind: e.kind,
      id: e.id,
    }));
  }

  function clear(): void {
    items = [];
    seq = 0;
  }

  return {
    rememberEntity,
    getEntityReferences,
    getRecentEntities,
    clear,
    /** Test helper */
    _size: () => items.length,
  };
}

export type EntityCache = ReturnType<typeof createEntityCache>;
