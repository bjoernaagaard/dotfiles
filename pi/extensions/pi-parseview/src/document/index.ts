import type { ExtensionAPI, ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import { findChromiumExecutable } from "../browser";
import { loadConfig } from "../config";
import { createFilesystemCacheStore } from "./cache";
import { loadResolvedConfig } from "./config";
import { gatherDoctorReport, formatDoctorReport } from "./doctor";
import { createNativeLoader, probeLiteparsePackageVersion } from "./native";
import { createLiteparseService, type DocumentService } from "./parser";
import { createParseTool } from "./tools/parse";
import { createQueryTool } from "./tools/query";
import { createScreenshotTool } from "./tools/screenshot";
import type { ActivationController } from "../tools/activation";

export interface ParseDocumentRuntime {
  config: Awaited<ReturnType<typeof loadResolvedConfig>>;
  cache: ReturnType<typeof createFilesystemCacheStore>;
  nativeLoader: ReturnType<typeof createNativeLoader>;
  service: ReturnType<typeof createLiteparseService>;
}

let runtimePromise: Promise<ParseDocumentRuntime> | null = null;

export async function initParseDocumentRuntime(): Promise<ParseDocumentRuntime> {
  if (!runtimePromise) {
    runtimePromise = (async () => {
      const packageVersion = await probeLiteparsePackageVersion();
      const config = await loadResolvedConfig(packageVersion);
      const nativeLoader = createNativeLoader();
      const cache = createFilesystemCacheStore(config.cacheDir, {
        maxDocumentCacheBytes: config.maxDocumentCacheBytes,
        maxTotalCacheBytes: config.maxTotalCacheBytes,
      });
      const service = createLiteparseService({ config, cache, nativeLoader });
      return { config, cache, nativeLoader, service };
    })();
  }

  const pending = runtimePromise;
  try {
    return await pending;
  } catch (error) {
    if (runtimePromise === pending) runtimePromise = null;
    throw error;
  }
}

export function resetParseDocumentRuntime(): void {
  runtimePromise = null;
}

function parseLegacyCommandArgs(args: string): {
  path: string;
  targetPages?: string;
  ocrMode?: "off";
} {
  const targetPages = args.match(/--pages\s+"([^"]+)"|--pages\s+(\S+)/);
  const filePath = args
    .replace(/\s+--no-ocr\b/g, "")
    .replace(/\s+--pages\s+"[^"]+"/g, "")
    .replace(/\s+--pages\s+\S+/g, "")
    .trim();
  return {
    path: filePath,
    targetPages: targetPages?.[1] ?? targetPages?.[2],
    ocrMode: /(?:^|\s)--no-ocr(?:\s|$)/.test(args) ? "off" : undefined,
  };
}

export function registerDocumentTools(pi: ExtensionAPI, activation?: ActivationController): void {
  const service: DocumentService = {
    parse: async (...args) => (await initParseDocumentRuntime()).service.parse(...args),
    read: async (...args) => (await initParseDocumentRuntime()).service.read(...args),
    search: async (...args) => (await initParseDocumentRuntime()).service.search(...args),
    screenshot: async (...args) => (await initParseDocumentRuntime()).service.screenshot(...args),
  };

  pi.registerTool(
    createParseTool(service, {
      onParsed: () => {
        activation?.markUsed("parse_document");
        activation?.activateAdditively(["query_document", "screenshot_document"]);
      },
    }),
  );
  pi.registerTool(createQueryTool(service));
  pi.registerTool(createScreenshotTool(service));

  pi.registerCommand("parse", {
    description: "Parse a local document. Usage: /parse <path> [--pages N-M] [--no-ocr]",
    handler: async (args, ctx: ExtensionCommandContext) => {
      if (!ctx.hasUI) return;
      if (!args.trim()) {
        ctx.ui.notify("Usage: /parse <path> [--pages 1-5,10] [--no-ocr]", "warning");
        return;
      }

      const input = parseLegacyCommandArgs(args);
      if (!input.path) {
        ctx.ui.notify("A document path is required", "warning");
        return;
      }

      ctx.ui.setStatus("parseview", "Parsing document…");
      try {
        const runtime = await initParseDocumentRuntime();
        const outcome = await runtime.service.parse(
          {
            path: input.path,
            targetPages: input.targetPages,
            ocrMode: input.ocrMode,
            format: "markdown",
          },
          { cwd: ctx.cwd, hasUI: ctx.hasUI, model: ctx.model },
          ctx.signal,
        );
        ctx.ui.notify(
          `Parsed ${outcome.manifest.pageCount} page(s); documentId: ${outcome.documentId}`,
          "info",
        );
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        ctx.ui.notify(`Parse failed: ${message}`, "error");
      } finally {
        ctx.ui.setStatus("parseview", undefined);
      }
    },
  });

  pi.registerCommand("parseview-doctor", {
    description: "Show document parser, cache, OCR, converter, and browser diagnostics",
    handler: async (_args, ctx: ExtensionCommandContext) => {
      if (!ctx.hasUI) return;
      const runtime = await initParseDocumentRuntime();
      const report = await gatherDoctorReport(runtime);
      const browser = findChromiumExecutable(loadConfig().puppeteerExecutablePath);
      ctx.ui.notify(`${formatDoctorReport(report)}\nbrowser: ${browser ?? "not found"}`, "info");
    },
  });

  pi.registerCommand("parseview-cache", {
    description: "Show cache status or clear it. Usage: /parseview-cache [status|clear]",
    handler: async (args, ctx: ExtensionCommandContext) => {
      if (!ctx.hasUI) return;
      const action = (args || "status").trim().toLowerCase() || "status";
      if (action !== "status" && action !== "clear") {
        ctx.ui.notify("Usage: /parseview-cache [status|clear]", "warning");
        return;
      }
      if (action === "clear") {
        const confirmed = await ctx.ui.confirm(
          "Clear ParseView document cache?",
          "Delete all cached document artifacts?",
        );
        if (!confirmed) return;
        const runtime = await initParseDocumentRuntime();
        await runtime.cache.clear();
        ctx.ui.notify("ParseView document cache cleared", "info");
        return;
      }

      const runtime = await initParseDocumentRuntime();
      const status = await runtime.cache.status();
      ctx.ui.notify(
        `ParseView document cache: ${status.entryCount} entr${status.entryCount === 1 ? "y" : "ies"}, ${status.bytes} bytes`,
        "info",
      );
    },
  });
}
