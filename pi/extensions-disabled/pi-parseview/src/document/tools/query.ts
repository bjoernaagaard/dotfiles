import { StringEnum } from "@earendil-works/pi-ai";
import { defineTool, formatSize } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { writeTempFile } from "../../utils";
import { DEFAULT_MAX_BYTES, DEFAULT_MAX_LINES, formatBoundedDocumentOutput } from "../output";
import type { DocumentService } from "../parser";
import { renderQueryCall, renderQueryResult } from "../renderers";
import type {
  QueryReadInput,
  QueryReadOutcome,
  QuerySearchInput,
  QuerySearchOutcome,
  QueryToolInput,
  ToolContext,
} from "../tool-types";

const ActionType = StringEnum(["read", "search"] as const, {
  description: "Use search to locate evidence, then read the smallest useful page or line window.",
});

export const QueryToolParameters = Type.Object(
  {
    action: ActionType,
    documentId: Type.String({
      minLength: 24,
      maxLength: 64,
      description:
        "Reusable documentId returned by parse_document; do not reparse for follow-up evidence.",
    }),
    page: Type.Optional(
      Type.Integer({
        minimum: 1,
        description: "Read one page when page evidence is the smallest useful window.",
      }),
    ),
    startLine: Type.Optional(
      Type.Integer({ minimum: 1, description: "First line for a bounded continuation read." }),
    ),
    lineCount: Type.Optional(
      Type.Integer({
        minimum: 1,
        maximum: 200,
        description: "Bounded line count; follow explicit continuation details when returned.",
      }),
    ),
    phrase: Type.Optional(
      Type.String({
        minLength: 1,
        description: "Phrase to search for before selecting a narrow read window.",
      }),
    ),
    caseSensitive: Type.Optional(Type.Boolean()),
    maxResults: Type.Optional(Type.Integer({ minimum: 1 })),
    contextChars: Type.Optional(Type.Integer({ minimum: 0, maximum: 2000 })),
  },
  { additionalProperties: false },
);

type QueryDetails = { phase?: string; [key: string]: unknown };

export function createQueryTool(service: DocumentService) {
  return defineTool<typeof QueryToolParameters, QueryDetails>({
    name: "query_document",
    label: "Parse Document Query",
    description:
      `Search to locate evidence, then read bounded page/line windows from a documentId returned by parse_document. ` +
      `Text is capped at ${DEFAULT_MAX_LINES} lines or ${formatSize(DEFAULT_MAX_BYTES)}; truncation is explicit and includes a strictly advancing continuation query or a full-output recovery path.`,
    parameters: QueryToolParameters,
    async execute(
      _toolCallId: string,
      params: QueryToolInput,
      signal: AbortSignal | undefined,
      onUpdate: ((update: any) => void) | undefined,
      ctx: ToolContext,
    ) {
      if (signal?.aborted) throw new Error("Operation aborted");
      const input = normalizeQueryInput(params);
      onUpdate?.({
        content: [{ type: "text", text: "Loading cached document" }],
        details: { phase: "validating" },
      });
      if (input.action === "read") {
        return formatQueryReadResult(await service.read(input, ctx, signal));
      }
      return formatQuerySearchResult(await service.search(input, ctx, signal));
    },
    renderCall: (args, theme, context) => renderQueryCall(args, theme, context),
    renderResult: (result, options, theme, context) =>
      renderQueryResult(result, options, theme, context),
  });
}

export async function formatQueryReadResult(outcome: QueryReadOutcome) {
  const provisional = await formatBoundedDocumentOutput(outcome.text);
  const originalStartLine = outcome.page === undefined ? outcome.lines[0]?.lineNumber : undefined;
  const candidateNextLine =
    !outcome.truncated && outcome.page === undefined && provisional.truncated
      ? outcome.lines[provisional.outputLines]?.lineNumber
      : undefined;
  const continuationStartLine =
    candidateNextLine !== undefined &&
    originalStartLine !== undefined &&
    candidateNextLine > originalStartLine
      ? candidateNextLine
      : undefined;
  const recoveryMessage = continuationStartLine
    ? `Continue with query_document action=read, documentId=${outcome.documentId}, startLine=${continuationStartLine}, lineCount=200.`
    : undefined;
  const bounded = provisional.truncated
    ? await formatBoundedDocumentOutput(outcome.text, {
        recoveryMessage,
        saveFullOutput: !recoveryMessage,
        extension: ".txt",
      })
    : provisional;

  let text = bounded.text;
  let fullOutputPath = bounded.fullOutputPath;
  if (outcome.truncated) {
    fullOutputPath = await writeTempFile(outcome.completeText, ".txt");
    text +=
      `\n\n[Document service output was bounded before formatting.` +
      ` Full requested read saved to: ${fullOutputPath}.]`;
  }

  return {
    content: [{ type: "text" as const, text }],
    details: {
      action: "read" as const,
      documentId: outcome.documentId,
      page: outcome.page,
      lineCount: outcome.lines.length,
      truncated: Boolean(outcome.truncated || bounded.truncated),
      upstreamTruncated: Boolean(outcome.truncated),
      outputTruncated: bounded.truncated,
      continuationStartLine,
      fullOutputPath,
      outputLines: bounded.outputLines,
      totalLines: bounded.totalLines,
      outputBytes: bounded.outputBytes,
      totalBytes: bounded.totalBytes,
    },
  };
}

export async function formatQuerySearchResult(outcome: QuerySearchOutcome) {
  const completeText = outcome.matches
    .map((match) => {
      const coords =
        match.x !== undefined
          ? ` @${Math.round(match.x)},${Math.round(match.y ?? 0)} ${Math.round(match.width ?? 0)}x${Math.round(match.height ?? 0)}`
          : "";
      const context = match.context ? ` — ${String(match.context)}` : "";
      return `p${match.pageNum}${coords}: ${match.text}${context}`;
    })
    .join("\n");
  const bounded = await formatBoundedDocumentOutput(completeText, {
    saveFullOutput: true,
    extension: ".txt",
  });
  let text = bounded.text;
  if (outcome.truncated) {
    text +=
      "\n\n[Search stopped at maxResults. Narrow the phrase or rerun query_document with a larger permitted maxResults.]";
  }

  return {
    content: [{ type: "text" as const, text }],
    details: {
      action: "search" as const,
      documentId: outcome.documentId,
      phrase: outcome.phrase,
      matchCount: outcome.matches.length,
      truncated: outcome.truncated || bounded.truncated,
      resultLimitTruncated: outcome.truncated,
      outputTruncated: bounded.truncated,
      fullOutputPath: bounded.fullOutputPath,
      outputLines: bounded.outputLines,
      totalLines: bounded.totalLines,
      outputBytes: bounded.outputBytes,
      totalBytes: bounded.totalBytes,
    },
  };
}

function normalizeQueryInput(params: unknown): QueryToolInput {
  if (!params || typeof params !== "object" || Array.isArray(params)) {
    throw new Error("Query arguments must be an object");
  }
  const input = params as Record<string, unknown>;
  if (input.action === "read") return normalizeReadInput(input);
  if (input.action === "search") return normalizeSearchInput(input);
  throw new Error("action must be read or search");
}

function normalizeReadInput(input: Record<string, unknown>): QueryReadInput {
  expectKeys(input, ["action", "documentId", "page", "startLine", "lineCount"]);
  const documentId = expectDocumentId(input.documentId);
  const page = optionalInteger(input.page, "page", 1);
  const startLine = optionalInteger(input.startLine, "startLine", 1);
  const lineCount = optionalInteger(input.lineCount, "lineCount", 1, 200);
  if (page !== undefined && (startLine !== undefined || lineCount !== undefined)) {
    throw new Error("read by page cannot include startLine or lineCount");
  }
  if (page === undefined && startLine === undefined)
    throw new Error("read requires page or startLine");
  return { action: "read", documentId, page, startLine, lineCount };
}

function normalizeSearchInput(input: Record<string, unknown>): QuerySearchInput {
  expectKeys(input, [
    "action",
    "documentId",
    "phrase",
    "caseSensitive",
    "maxResults",
    "contextChars",
  ]);
  const documentId = expectDocumentId(input.documentId);
  if (typeof input.phrase !== "string" || !input.phrase.trim()) {
    throw new Error("phrase is required for search");
  }
  if (input.caseSensitive !== undefined && typeof input.caseSensitive !== "boolean") {
    throw new Error("caseSensitive must be boolean");
  }
  return {
    action: "search",
    documentId,
    phrase: input.phrase,
    caseSensitive: input.caseSensitive,
    maxResults: optionalInteger(input.maxResults, "maxResults", 1),
    contextChars: optionalInteger(input.contextChars, "contextChars", 0, 2_000),
  };
}

function expectDocumentId(value: unknown): string {
  if (typeof value !== "string" || !/^[0-9a-f]{24,64}$/.test(value)) {
    throw new Error("documentId must be a lowercase hex cache id");
  }
  return value;
}

function optionalInteger(
  value: unknown,
  name: string,
  minimum: number,
  maximum = Number.MAX_SAFE_INTEGER,
): number | undefined {
  if (
    value !== undefined &&
    (typeof value !== "number" ||
      !Number.isSafeInteger(value) ||
      value < minimum ||
      value > maximum)
  ) {
    throw new Error(`${name} must be an integer between ${minimum} and ${maximum}`);
  }
  return value as number | undefined;
}

function expectKeys(value: Record<string, unknown>, keys: string[]): void {
  for (const key of Object.keys(value)) {
    if (!keys.includes(key)) throw new Error(`Unexpected query argument: ${key}`);
  }
}
