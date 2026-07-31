import { formatSize } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { DEFAULT_MAX_BYTES, DEFAULT_MAX_LINES, formatBoundedDocumentOutput } from "../output";
import type { DocumentService } from "../parser";
import { renderScreenshotCall, renderScreenshotResult } from "../renderers";
import type { ScreenshotOutcome, ScreenshotToolInput, ToolContext } from "../tool-types";

export const ScreenshotToolParameters = Type.Object(
  {
    documentId: Type.String({
      minLength: 24,
      maxLength: 64,
      description: "Cached non-text documentId returned by parse_document.",
    }),
    pages: Type.Array(Type.Integer({ minimum: 1 }), {
      minItems: 1,
      description: "Smallest useful set of page numbers whose layout needs visual inspection.",
    }),
    dpi: Type.Optional(
      Type.Integer({
        minimum: 1,
        description:
          "Screenshot DPI; start at the configured 150 DPI unless more detail is needed.",
      }),
    ),
    includeImages: Type.Optional(
      Type.Boolean({
        description: "Return selected PNGs inline in addition to the bounded path manifest.",
      }),
    ),
  },
  { additionalProperties: false },
);

export function createScreenshotTool(service: DocumentService) {
  return {
    name: "screenshot_document",
    label: "Document Screenshot",
    description:
      `Render the smallest useful selected page set from a cached non-text documentId to PNG files, starting at 150 DPI unless detail requires more. ` +
      `The bounded path manifest is capped at ${DEFAULT_MAX_LINES} lines or ${formatSize(DEFAULT_MAX_BYTES)} and is saved in full if truncated; preserve the returned paths and use inline images only when useful.`,
    parameters: ScreenshotToolParameters,
    executionMode: "sequential" as const,
    async execute(
      _toolCallId: string,
      params: ScreenshotToolInput,
      signal: AbortSignal | undefined,
      onUpdate: any,
      ctx: ToolContext,
    ) {
      if (signal?.aborted) throw new Error("Operation aborted");
      const update = (phase: string, message: string) =>
        onUpdate?.({
          content: [{ type: "text", text: message }],
          details: { phase },
        });
      const outcome = await service.screenshot(params, ctx, signal, update);
      return formatScreenshotResult(outcome);
    },
    renderCall: (args: ScreenshotToolInput, theme: any, context: any) =>
      renderScreenshotCall(args, theme, context),
    renderResult: (
      result: any,
      options: { expanded: boolean; isPartial: boolean },
      theme: any,
      context: any,
    ) => renderScreenshotResult(result, options, theme, context),
  };
}

export async function formatScreenshotResult(outcome: ScreenshotOutcome) {
  const manifest = outcome.pages.map((page) => `${page.pageNum}: ${page.path}`).join("\n");
  const bounded = await formatBoundedDocumentOutput(manifest, {
    saveFullOutput: true,
    extension: ".txt",
  });
  return {
    content: [{ type: "text" as const, text: bounded.text }, ...(outcome.images ?? [])],
    details: {
      documentId: outcome.documentId,
      pageCount: outcome.pages.length,
      pages: outcome.pages,
      imageCount: outcome.images?.length ?? 0,
      paths: outcome.pages.map((page) => page.path),
      truncated: bounded.truncated,
      fullOutputPath: bounded.fullOutputPath,
      outputLines: bounded.outputLines,
      totalLines: bounded.totalLines,
      outputBytes: bounded.outputBytes,
      totalBytes: bounded.totalBytes,
    },
  };
}
