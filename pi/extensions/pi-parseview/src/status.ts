import type { ExtensionContext } from "@earendil-works/pi-coding-agent";

/** Composable footer key; consumers such as pi-statusline read Pi's status map. */
export const PARSEVIEW_STATUS_KEY = "parseview";

export type ParseViewAvailability = {
  parser: boolean;
  browser: boolean;
};

/** Keep the persistent segment short while making degraded dependencies visible. */
export function formatParseViewStatus({ parser, browser }: ParseViewAvailability): string {
  return `📄 PV parse ${parser ? "ready" : "missing"} web ${browser ? "ready" : "missing"}`;
}

export function setParseViewStatus(
  ctx: Pick<ExtensionContext, "hasUI" | "ui">,
  availability: ParseViewAvailability | undefined,
): void {
  if (!ctx.hasUI) return;
  const setStatus = ctx.ui.setStatus;
  if (typeof setStatus !== "function") return;
  setStatus.call(
    ctx.ui,
    PARSEVIEW_STATUS_KEY,
    availability === undefined ? undefined : formatParseViewStatus(availability),
  );
}
