import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import type { DagsterRuntime } from "../runtime.ts";

/**
 * Author module: registration hook for local authoring surfaces.
 * Phase 2: dg tools registered centrally via registerAllTools;
 * `/dagster-dev` lives in ui.ts (single command home).
 * This module stays a composition hook for future author-only registrations.
 */
export function registerAuthor(_pi: ExtensionAPI, _runtime: DagsterRuntime): void {
  // Tools: registerAllTools → createDgCommandTool
  // Commands: registerUi → /dagster-dev
}
