import { StringEnum } from "@earendil-works/pi-ai";
import {
  DEFAULT_MAX_BYTES,
  DEFAULT_MAX_LINES,
  formatSize,
  truncateHead,
} from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { writeTempFile } from "../../utils";
import type { ParseOutcome, ParseToolInput, ToolContext } from "../tool-types";
import type { DocumentService } from "../parser";
import { renderParseCall, renderParseResult } from "../renderers";

export const ParseToolParameters = Type.Object(
  {
    path: Type.String({
      minLength: 1,
      description: "Path to a local regular file; URLs and non-file inputs are rejected.",
    }),
    format: Type.Optional(
      StringEnum(["text", "markdown", "json"] as const, {
        description: "Output format: text, markdown, or json",
      }),
    ),
    ocrMode: Type.Optional(
      StringEnum(["auto", "on", "off"] as const, {
        description:
          "OCR mode: auto when composition is uncertain, on for scans, off for known born-digital files.",
      }),
    ),
    ocrLanguage: Type.Optional(
      Type.String({ minLength: 1, description: "OCR language when OCR is enabled." }),
    ),
    targetPages: Type.Optional(
      Type.String({
        minLength: 1,
        description: "Optional page selection; narrow parsing when only selected pages are needed.",
      }),
    ),
    maxPages: Type.Optional(Type.Integer({ minimum: 1, description: "Maximum pages to parse." })),
    dpi: Type.Optional(
      Type.Integer({ minimum: 1, description: "Rasterization DPI for image/layout work." }),
    ),
    imageMode: Type.Optional(
      StringEnum(["off", "placeholder", "embed"] as const, {
        description: "Image mode: off, placeholder, or embed",
      }),
    ),
    extractLinks: Type.Optional(Type.Boolean()),
    preserveVerySmallText: Type.Optional(Type.Boolean()),
    emitWordBoxes: Type.Optional(Type.Boolean()),
    skipDiagonalText: Type.Optional(Type.Boolean()),
    includeComplexity: Type.Optional(Type.Boolean()),
    cropBox: Type.Optional(
      Type.Object(
        {
          top: Type.Number({ minimum: 0, maximum: 1 }),
          right: Type.Number({ minimum: 0, maximum: 1 }),
          bottom: Type.Number({ minimum: 0, maximum: 1 }),
          left: Type.Number({ minimum: 0, maximum: 1 }),
        },
        { additionalProperties: false },
      ),
    ),
    force: Type.Optional(Type.Boolean()),
  },
  { additionalProperties: false },
);

export interface CreateParseToolOptions {
  onParsed?: () => void;
}

export function prepareParseArguments(args: unknown): any {
  if (!args || typeof args !== "object" || Array.isArray(args)) return args;
  const prepared = { ...(args as Record<string, unknown>) };

  if (typeof prepared.path === "string" && prepared.path.startsWith("@")) {
    prepared.path = prepared.path.slice(1);
  }
  if (typeof prepared.pages === "string") {
    if (prepared.targetPages === undefined) prepared.targetPages = prepared.pages;
    delete prepared.pages;
  }
  if (typeof prepared.useOcr === "boolean") {
    if (prepared.ocrMode === undefined) prepared.ocrMode = prepared.useOcr ? "on" : "off";
    delete prepared.useOcr;
  }
  return prepared;
}

export function createParseTool(service: DocumentService, options: CreateParseToolOptions = {}) {
  return {
    name: "parse_document",
    label: "Parse Document",
    description:
      `Parse one local PDF, Office, image, or plain-text file into cached text and return a reusable documentId. ` +
      `Inline output is bounded to ${DEFAULT_MAX_LINES} lines or ${formatSize(DEFAULT_MAX_BYTES)}; full truncated output is saved to a temporary file. ` +
      "Parse once and retain documentId; choose OCR deliberately (auto for uncertain composition, off for born-digital, on for scans). After success, use query_document for bounded reads/searches or screenshot_document for selected page layout.",
    parameters: ParseToolParameters,
    prepareArguments: prepareParseArguments,
    executionMode: "sequential" as const,
    async execute(
      _toolCallId: string,
      params: ParseToolInput,
      signal: AbortSignal | undefined,
      onUpdate: ((update: any) => void) | undefined,
      ctx: ToolContext,
    ) {
      if (signal?.aborted) throw new Error("Operation aborted");
      const update = (phase: string, message: string) =>
        onUpdate?.({
          content: [{ type: "text", text: message }],
          details: { phase },
        });
      const serviceInput = normalizeParseInput(params);
      const outcome = await service.parse(serviceInput, ctx, signal, update);
      options.onParsed?.();
      return formatParseResult(outcome, serviceInput.format ?? "markdown");
    },
    renderCall: (args: ParseToolInput, theme: any, context: any) =>
      renderParseCall(args, theme, context),
    renderResult: (
      result: any,
      options: { expanded: boolean; isPartial: boolean },
      theme: any,
      context: any,
    ) => renderParseResult(result, options, theme, context),
  };
}

export async function formatParseResult(
  outcome: ParseOutcome,
  requestedFormat: "text" | "markdown" | "json" = "markdown",
) {
  const sourceText =
    requestedFormat === "markdown"
      ? (outcome.documentMarkdown ?? outcome.documentText)
      : requestedFormat === "json"
        ? (outcome.documentJson ?? outcome.documentText)
        : outcome.documentText;
  const preview = truncateHead(sourceText, {
    maxLines: DEFAULT_MAX_LINES,
    maxBytes: DEFAULT_MAX_BYTES,
  });

  let fullOutputPath: string | undefined;
  if (preview.truncated) {
    const ext = requestedFormat === "text" ? ".txt" : requestedFormat === "json" ? ".json" : ".md";
    fullOutputPath = await writeTempFile(sourceText, ext);
  }

  const text = preview.truncated
    ? `${preview.content}\n\n[Output truncated: ${preview.outputLines} of ${preview.totalLines} lines` +
      ` (${formatSize(preview.outputBytes)} of ${formatSize(preview.totalBytes)}).` +
      ` Full output saved to: ${fullOutputPath}]`
    : preview.content;

  return {
    content: [{ type: "text" as const, text }],
    details: {
      documentId: outcome.documentId,
      pageCount: outcome.manifest.pageCount,
      cacheHit: outcome.cacheHit,
      source: outcome.manifest.source.realPath,
      file: outcome.manifest.source.realPath,
      pages: outcome.manifest.redactedConfig.targetPages ?? "all",
      pagesParsed: outcome.manifest.pageCount,
      format: outcome.manifest.redactedConfig.format,
      ocrModeRequested: outcome.ocrModeRequested,
      ocrModeResolved: outcome.ocrModeResolved,
      artifactPaths: outcome.artifactPaths,
      fullOutputPath,
      complexity: outcome.complexity?.length ?? 0,
      truncated: preview.truncated,
    },
  };
}

function normalizeParseInput(params: ParseToolInput): ParseToolInput {
  if (typeof params.path !== "string" || !params.path.trim()) throw new Error("path is required");
  return { ...params, format: params.format ?? "markdown" };
}
