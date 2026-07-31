import type { ExtensionContext } from "@earendil-works/pi-coding-agent";

export const AST_GREP_STATUS_KEY = "ast-grep";

export type AstGrepStatusState = "ready" | "preview" | "applying" | "error";

export function formatAstGrepStatus(
  ctx: Pick<ExtensionContext, "ui">,
  state: AstGrepStatusState,
  style: "powerline" | "ascii" = "powerline",
): string {
  const label = state === "ready" ? "sg" : `sg:${state}`;
  if (style === "ascii") return ctx.ui.theme.fg(state === "error" ? "warning" : "accent", `[${label}]`);
  return ctx.ui.theme.fg(state === "error" ? "warning" : "accent", ` ${label}`);
}

/** Set or clear only this extension's composable footer segment. */
export function setAstGrepStatus(
  ctx: Pick<ExtensionContext, "hasUI" | "ui">,
  state: AstGrepStatusState | undefined,
  style: "powerline" | "ascii" = "powerline",
): void {
  if (!ctx.hasUI) return;
  ctx.ui.setStatus(AST_GREP_STATUS_KEY, state === undefined ? undefined : formatAstGrepStatus(ctx, state, style));
}
