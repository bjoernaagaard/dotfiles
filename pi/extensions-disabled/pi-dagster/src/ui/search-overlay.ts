/**
 * Limited read-only TUI overlay for /dagster-search.
 * RPC/non-TUI falls back to notify/text — no overlay dependency.
 */
import type { ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import { DynamicBorder } from "@earendil-works/pi-coding-agent";
import { Container, type SelectItem, SelectList, Text } from "@earendil-works/pi-tui";
import type { DagsterRuntime } from "../runtime.ts";
import {
  runCrossEntitySearch,
  searchHitEditorToken,
} from "../domain/cross-search.ts";
import type { SearchHit } from "../domain/search.ts";
import { formatSearchHits } from "../domain/search.ts";

export type SearchOverlaySelection = {
  token: string;
  hit: SearchHit;
};

/**
 * Pure helper: format search hits as select items (max 20).
 */
export function searchHitsToSelectItems(hits: SearchHit[]): SelectItem[] {
  return hits.slice(0, 20).map((h) => ({
    value: searchHitEditorToken(h),
    label: `[${h.kind}] ${h.label}`,
    description: h.id !== h.label ? h.id : h.kind,
  }));
}

/**
 * Run cross-entity search and present results.
 * - TUI: SelectList overlay; selection pastes a safe token into the editor.
 * - RPC/hasUI: select dialog or notify text.
 * - print/json: notify text summary.
 * Cancel is a no-op.
 */
export async function handleDagsterSearchCommand(
  args: string,
  ctx: ExtensionCommandContext,
  runtime: DagsterRuntime,
): Promise<{ matches: SearchHit[]; selected?: string }> {
  let query = args.trim();
  if (!query && ctx.hasUI) {
    query = (await ctx.ui.input("Search query", ""))?.trim() ?? "";
  }
  if (!query) {
    await ctx.ui.notify(
      "Usage: /dagster-search <query>\nRead-only cross-entity search. TUI shows a result picker; RPC/print gets text.",
      "error",
    );
    return { matches: [] };
  }

  if (runtime.closed) {
    await ctx.ui.notify("Dagster runtime is shut down", "error");
    return { matches: [] };
  }

  let matches: SearchHit[] = [];
  let text = "";
  try {
    const client = await runtime.ensureClient({ signal: ctx.signal });
    const result = await runCrossEntitySearch(client, {
      query,
      limit: 20,
      signal: ctx.signal,
    });
    matches = result.matches;
    text = result.text;
  } catch (err) {
    await ctx.ui.notify(
      err instanceof Error ? err.message : String(err),
      "error",
    );
    return { matches: [] };
  }

  for (const m of matches) {
    runtime.rememberEntity(m.kind, m.id, {
      label: m.label,
      description: m.kind,
    });
  }

  if (matches.length === 0) {
    await ctx.ui.notify(text || "No matches.", "info");
    return { matches };
  }

  // TUI overlay path
  if (ctx.mode === "tui") {
    const items = searchHitsToSelectItems(matches);
    try {
      const selected = await ctx.ui.custom<string | null>(
        (tui, theme, _kb, done) => {
          const container = new Container();
          container.addChild(new DynamicBorder((str) => theme.fg("accent", str)));
          container.addChild(
            new Text(theme.fg("accent", theme.bold(`Dagster search: ${query}`)), 0, 0),
          );
          const selectList = new SelectList(items, Math.min(items.length, 12), {
            selectedPrefix: (t) => theme.fg("accent", t),
            selectedText: (t) => theme.fg("accent", t),
            description: (t) => theme.fg("muted", t),
            scrollInfo: (t) => theme.fg("dim", t),
            noMatch: (t) => theme.fg("warning", t),
          });
          selectList.onSelect = (item) => done(item.value);
          selectList.onCancel = () => done(null);
          container.addChild(selectList);
          container.addChild(
            new Text(theme.fg("dim", "↑↓ navigate • enter insert • esc cancel"), 0, 0),
          );
          container.addChild(new DynamicBorder((str) => theme.fg("accent", str)));
          return {
            render(width: number) {
              return container.render(width);
            },
            invalidate() {
              container.invalidate();
            },
            handleInput(data: string) {
              selectList.handleInput(data);
              tui.requestRender();
            },
          };
        },
        { overlay: true, overlayOptions: { anchor: "center", width: "70%" } },
      );

      if (selected) {
        try {
          ctx.ui.pasteToEditor(`${selected} `);
        } catch {
          try {
            ctx.ui.setEditorText(selected);
          } catch {
            // ignore
          }
        }
        await ctx.ui.notify(`Selected ${selected}`, "info");
        return { matches, selected };
      }
      // cancel — no-op
      return { matches };
    } catch {
      // Fall through to text notify if custom UI fails
    }
  }

  // RPC with select dialog
  if (ctx.hasUI && ctx.mode !== "tui") {
    try {
      const labels = matches.slice(0, 20).map((m) => `[${m.kind}] ${m.label}`);
      const picked = await ctx.ui.select("Search results", labels);
      if (picked) {
        const idx = labels.indexOf(picked);
        const hit = matches[idx];
        if (hit) {
          const token = searchHitEditorToken(hit);
          try {
            ctx.ui.setEditorText(token);
          } catch {
            // ignore
          }
          await ctx.ui.notify(`Selected ${token}`, "info");
          return { matches, selected: token };
        }
      }
      return { matches };
    } catch {
      // fall through
    }
  }

  // print/json or fallback: text summary via notify
  await ctx.ui.notify(formatSearchHits(matches), "info");
  return { matches };
}
