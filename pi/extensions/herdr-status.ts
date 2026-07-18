// Optional companion to the managed herdr-agent-state.ts integration.
// Keep Herdr's generated file untouched; this small extension only publishes
// a composable Pi footer segment when the process is inside a Herdr pane.

import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";

const STATUS_KEY = "herdr";
const HERDR_ENABLED =
  process.env.HERDR_ENV === "1" &&
  Boolean(process.env.HERDR_SOCKET_PATH) &&
  Boolean(process.env.HERDR_PANE_ID);

type HerdrState = "active" | "blocked";

function formatStatus(state: HerdrState): string {
  return `🪶 herdr ${state}`;
}

export default function herdrStatus(pi: ExtensionAPI): void {
  if (!HERDR_ENABLED) return;

  let context: ExtensionContext | undefined;

  const publish = (state: HerdrState): void => {
    if (!context?.hasUI) return;
    context.ui.setStatus(STATUS_KEY, formatStatus(state));
  };

  pi.on("session_start", (_event: unknown, ctx: ExtensionContext) => {
    context = ctx;
    publish("active");
  });

  pi.events.on("herdr:blocked", (data: any) => {
    if (data?.active) publish("blocked");
    else publish("active");
  });

  pi.on("session_shutdown", (_event: unknown, ctx: ExtensionContext) => {
    if (ctx.hasUI) ctx.ui.setStatus(STATUS_KEY, undefined);
    context = undefined;
  });
}
