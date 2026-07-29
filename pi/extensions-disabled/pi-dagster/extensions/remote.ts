import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

/**
 * Opt-in remote/ops bridge entrypoint.
 * Behaviorally inert by default: no built-in overrides, no resources, no providers.
 * Runtime enablement lands in a later phase.
 */
export default function (pi: ExtensionAPI): void {
  pi.registerCommand("dagster-remote", {
    description: "Dagster remote module status (inactive by default)",
    handler: async (_args, ctx) => {
      await ctx.ui.notify(
        [
          "pi-dagster remote module is loaded but inactive.",
          "It does not override built-ins or open resources until explicitly enabled.",
          "Enablement remains opt-in and is not part of the default Phase 5 core polish package.",
        ].join("\n"),
        "info",
      );
    },
  });
}
