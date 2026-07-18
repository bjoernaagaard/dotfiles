import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import type { DagsterRuntime } from "../runtime.ts";
import type { AuditEntry } from "../policy/audit.ts";
import { renderAuditEntryCard } from "../render/index.ts";

/**
 * Operate module (Phase 3): agent_settled watch flush + audit entry renderer.
 * Factory remains free of sockets — watches start on first use.
 */
export function registerOperate(pi: ExtensionAPI, runtime: DagsterRuntime): void {
  // TUI-only audit cards (not LLM context).
  try {
    pi.registerEntryRenderer<AuditEntry>("dagster.audit", (entry, options, theme) => {
      return renderAuditEntryCard(entry.data, theme, {
        expanded: Boolean((options as { expanded?: boolean } | undefined)?.expanded),
      });
    });
  } catch {
    // Older Pi without entry renderers — ignore.
  }

  pi.on("agent_settled", async (_event, ctx) => {
    if (runtime.closed) return;
    const pending = runtime.takePendingWatchNotifications("settled");
    if (pending.length === 0) return;

    for (const n of pending) {
      const text = [
        n.summary,
        n.logPath ? `logPath: ${n.logPath}` : null,
        `watchId: ${n.watchId}`,
      ]
        .filter(Boolean)
        .join("\n");

      // Notify-first (hasUI); avoid surprise model turns unless notifyModel was requested.
      try {
        if (ctx.hasUI) {
          await ctx.ui.notify(text, n.urgent ? "warning" : "info");
        }
      } catch {
        // ignore notify failures
      }

      if (n.notifyModel && n.urgent) {
        try {
          // Prefer followUp so the next agent turn sees the failure summary.
          const send = (
            pi as ExtensionAPI & {
              sendUserMessage?: (
                content: string,
                options?: { deliverAs?: "steer" | "followUp" },
              ) => void;
            }
          ).sendUserMessage;
          if (typeof send === "function") {
            send(`[dagster watch] ${n.summary}`, { deliverAs: "followUp" });
          }
        } catch {
          // ignore
        }
      }
    }
  });
}
