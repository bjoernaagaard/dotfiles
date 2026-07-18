import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { registerDocumentTools } from "../document/index";
import type { ActivationController } from "../tools/activation";

export function registerParser(pi: ExtensionAPI, activation?: ActivationController): void {
  registerDocumentTools(pi, activation);
}
