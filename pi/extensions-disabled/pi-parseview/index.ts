import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { getAgentDir } from "@earendil-works/pi-coding-agent";
import { registerAutotrigger } from "./src/autotrigger/index";
import { closeBrowser, findChromiumExecutable, setBrowserAvailable } from "./src/browser";
import { initConfig, loadConfig } from "./src/config";
import { registerDiagram } from "./src/diagram/index";
import { resetParseDocumentRuntime } from "./src/document/index";
import { loadNativeAdapter } from "./src/document/native";
import { registerMermaid } from "./src/mermaid/index";
import { registerParser } from "./src/parser/index";
import { setLiteparseAvailable } from "./src/parser/parse-core";
import { registerPreview } from "./src/preview/index";
import { setParseViewStatus } from "./src/status";
import { createActivationController } from "./src/tools/activation";

async function canLoadLiteparse(): Promise<boolean> {
  try {
    await loadNativeAdapter();
    return true;
  } catch {
    return false;
  }
}

async function updateAvailability(): Promise<{ browser: boolean; parser: boolean }> {
  const parserAvailable = await canLoadLiteparse();
  setLiteparseAvailable(parserAvailable);

  const browserAvailable = Boolean(findChromiumExecutable(loadConfig().puppeteerExecutablePath));
  setBrowserAvailable(browserAvailable);

  return { browser: browserAvailable, parser: parserAvailable };
}

export default function (pi: ExtensionAPI) {
  const activation = createActivationController(pi);

  registerDiagram(pi);
  registerMermaid(pi);
  registerPreview(pi);
  registerParser(pi, activation);
  registerAutotrigger(pi, activation);

  pi.on("session_start", async (_event, ctx) => {
    initConfig(ctx.cwd, getAgentDir());

    const { browser, parser } = await updateAvailability();
    activation.setParserAvailable(parser);
    activation.resetForSession();
    setParseViewStatus(ctx, { browser, parser });
    if (!ctx.hasUI) return;

    if (!parser) {
      ctx.ui.notify(
        "Document parsing unavailable: LiteParse could not load. Run /parseview-doctor for details.",
        "warning",
      );
    }
    if (!browser) {
      ctx.ui.notify(
        "PNG/PDF preview export unavailable: no Chromium executable found. HTML/browser previews still work; install Chrome/Brave/Edge or set puppeteerExecutablePath in settings.",
        "warning",
      );
    }
  });

  pi.on("tool_execution_start", (event) => {
    activation.markUsed(event.toolName);
  });

  pi.on("agent_settled", () => {
    activation.settle();
  });

  pi.on("session_shutdown", async (_event, ctx) => {
    setParseViewStatus(ctx, undefined);
    activation.shutdown();
    resetParseDocumentRuntime();
    await closeBrowser();
  });
}
