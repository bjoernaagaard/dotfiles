import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

/**
 * Opt-in private model provider entrypoint.
 * Behaviorally inert by default: does not call registerProvider or open resources.
 */
export default function (pi: ExtensionAPI): void {
  pi.registerCommand("dagster-provider", {
    description: "Dagster provider module status (inactive by default)",
    handler: async (_args, ctx) => {
      await ctx.ui.notify(
        [
          "pi-dagster provider module is loaded but inactive.",
          "It does not register providers until explicitly enabled.",
          "Enablement remains opt-in and is not part of the default Phase 5 core polish package.",
        ].join("\n"),
        "info",
      );
    },
  });
}
