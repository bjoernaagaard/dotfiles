import { readFile, realpath, stat } from "node:fs/promises";
import path from "node:path";
import type {
  CacheManifest,
  CacheStore,
  CropBox,
  DocumentCacheEntry,
  ImageMode,
  LiteparseServiceDeps,
  NativeAdapter,
  NativePageComplexityStats,
  NativeParsedPage,
  NativeParseResult,
  NativeTextItem,
  PageArtifact,
  PageLineArtifact,
  ParseOutcome,
  ParseToolInput,
  QueryReadInput,
  QueryReadOutcome,
  QuerySearchInput,
  QuerySearchMatch,
  QuerySearchOutcome,
  ResolvedConfig,
  ScreenshotOutcome,
  ScreenshotToolInput,
  SearchItemsOptions,
  SourceKind,
  SourceResolution,
  SupportedFormat,
  TextItemPageArtifact,
  ToolContext,
  OcrMode,
} from "./tool-types";
import { SCHEMA_VERSION } from "./config";
import {
  abortError,
  compactObject,
  isFiniteNonNegativeInteger,
  isFinitePositiveInteger,
  isFinitePositiveNumber,
  sha256Hex,
  sha256Prefix,
  stableStringify,
  truncateUtf8WithEllipsis,
  utf8ByteLength,
} from "./utils";

const PLAIN_TEXT_EXTS = new Set([".txt", ".md", ".markdown", ".log"]);
const PDF_EXTS = new Set([".pdf"]);
const OFFICE_EXTS = new Set([
  ".doc",
  ".docx",
  ".docm",
  ".dot",
  ".dotm",
  ".dotx",
  ".odt",
  ".ott",
  ".rtf",
  ".pages",
]);
const PRESENTATION_EXTS = new Set([
  ".ppt",
  ".pptx",
  ".pptm",
  ".pot",
  ".potm",
  ".potx",
  ".odp",
  ".otp",
  ".key",
]);
const SPREADSHEET_EXTS = new Set([
  ".xls",
  ".xlsx",
  ".xlsm",
  ".xlsb",
  ".ods",
  ".ots",
  ".csv",
  ".tsv",
  ".numbers",
]);
const IMAGE_EXTS = new Set([
  ".jpg",
  ".jpeg",
  ".png",
  ".gif",
  ".bmp",
  ".tiff",
  ".tif",
  ".webp",
  ".svg",
]);

const DEFAULT_LINE_COUNT = 40;
const DEFAULT_CONTEXT_CHARS = 120;

export type DocumentService = Pick<LiteparseService, "parse" | "read" | "search" | "screenshot">;

export function createLiteparseService(deps: LiteparseServiceDeps) {
  return new LiteparseService(deps);
}

export class LiteparseService {
  constructor(private readonly deps: LiteparseServiceDeps) {}

  async status() {
    return this.deps.cache.status();
  }

  async clear() {
    return this.deps.cache.clear();
  }

  async parse(
    input: ParseToolInput,
    ctx: ToolContext,
    signal?: AbortSignal,
    progress?: (phase: string, message: string) => void,
  ): Promise<ParseOutcome> {
    ensureNotAborted(signal);
    progress?.("validating", "Validating source");
    const settings = resolveParseSettings(this.deps.config, input);
    const source = await resolveSource(input.path, ctx.cwd, this.deps.config.maxInputBytes);
    const sourceBytes = await readFile(source.realPath);
    ensureNotAborted(signal);
    if (sourceBytes.byteLength > this.deps.config.maxInputBytes) {
      throw new Error(
        `Source exceeds maxInputBytes (${sourceBytes.byteLength} > ${this.deps.config.maxInputBytes})`,
      );
    }
    source.size = sourceBytes.byteLength;
    source.sha256 = sha256Hex(sourceBytes);
    progress?.("hashing", "Hashing source");

    const cacheKey = buildCacheKey(this.deps.config, source, settings);
    const documentId = buildDocumentId(cacheKey.cacheKeyHash);

    if (!settings.force) {
      const cached = await this.deps.cache.get(documentId);
      if (
        cached &&
        cacheEntryMatches(
          cached.manifest,
          cacheKey.cacheKey,
          cacheKey.cacheKeyHash,
          source,
          this.deps.config.packageVersion,
        )
      ) {
        ensureNotAborted(signal);
        return buildParseOutcome({
          documentId,
          cacheDir: this.deps.config.cacheDir,
          cacheHit: true,
          manifest: cached.manifest,
          documentText: cached.documentText,
          documentMarkdown: cached.documentMarkdown,
          documentJson: cached.documentJson,
          pages: cached.pages,
          textItems: cached.textItems,
          preview: previewDocument(
            settings.format,
            cached.documentText,
            cached.documentMarkdown,
            cached.documentJson,
            this.deps.config.maxOutputBytes,
          ),
          ocrModeRequested: settings.ocrMode,
          ocrModeResolved: cached.manifest.redactedConfig.ocrModeResolved === "on" ? "on" : "off",
          complexity: extractComplexity(cached.pages),
        });
      }
      if (cached) await this.deps.cache.delete(documentId);
    }

    if (source.plainText) {
      progress?.("parsing", "Parsing plain text");
      const entry = buildPlainTextDocument({
        config: this.deps.config,
        source,
        settings,
        bytes: sourceBytes,
        cacheKey,
        documentId,
      });
      progress?.("writing-cache", "Writing cache");
      const stored = await persistEntryUnlessAborted(this.deps.cache, entry.entry, signal);
      return buildParseOutcome({
        documentId,
        cacheDir: this.deps.config.cacheDir,
        cacheHit: false,
        manifest: stored.manifest,
        documentText: stored.documentText,
        documentMarkdown: stored.documentMarkdown,
        documentJson: stored.documentJson,
        pages: stored.pages,
        textItems: stored.textItems,
        preview: previewDocument(
          settings.format,
          stored.documentText,
          stored.documentMarkdown,
          stored.documentJson,
          this.deps.config.maxOutputBytes,
        ),
        ocrModeRequested: settings.ocrMode,
        ocrModeResolved: "off",
        complexity: extractComplexity(stored.pages),
      });
    }

    const adapter = await loadNativeAdapterOrThrow(this.deps.nativeLoader);
    let complexity: NativePageComplexityStats[] | undefined;
    let ocrResolved: "on" | "off" = settings.ocrMode === "on" ? "on" : "off";

    if (settings.ocrMode === "auto") {
      progress?.("complexity", "Checking document complexity");
      const complexityProbe = adapter.create(buildNativeConfig(this.deps.config, settings, false));
      complexity = await complexityProbe.isComplex(source.realPath);
      ensureNotAborted(signal);
      ocrResolved = complexity.some((page) => page.needsOcr) ? "on" : "off";
    }

    progress?.("parsing", ocrResolved === "on" ? "Parsing document with OCR" : "Parsing document");
    const native = adapter.create(
      buildNativeConfig(this.deps.config, settings, ocrResolved === "on"),
    );
    const result = await native.parse(source.realPath);
    ensureNotAborted(signal);
    const built = buildNativeDocument({
      source,
      settings,
      result,
      complexity,
      config: this.deps.config,
      packageVersion: adapter.version,
      ocrResolved,
      cacheKey,
      documentId,
    });

    progress?.("writing-cache", "Writing cache");
    const stored = await persistEntryUnlessAborted(this.deps.cache, built.entry, signal);
    return buildParseOutcome({
      documentId,
      cacheDir: this.deps.config.cacheDir,
      cacheHit: false,
      manifest: stored.manifest,
      documentText: stored.documentText,
      documentMarkdown: stored.documentMarkdown,
      documentJson: stored.documentJson,
      pages: stored.pages,
      textItems: stored.textItems,
      preview: previewDocument(
        settings.format,
        stored.documentText,
        stored.documentMarkdown,
        stored.documentJson,
        this.deps.config.maxOutputBytes,
      ),
      ocrModeRequested: settings.ocrMode,
      ocrModeResolved: ocrResolved,
      complexity: complexity ?? extractComplexity(stored.pages),
    });
  }

  async read(
    input: QueryReadInput,
    _ctx: ToolContext,
    signal?: AbortSignal,
  ): Promise<QueryReadOutcome> {
    ensureNotAborted(signal);
    validateReadInput(input);
    const entry = await loadDocumentOrThrow(this.deps.cache, input.documentId);
    ensureNotAborted(signal);

    if (input.page !== undefined) {
      const page = entry.pages.find((candidate) => candidate.pageNum === input.page);
      if (!page) throw new Error(`Page ${input.page} not found in document ${input.documentId}`);
      const text = truncateForOutput(page.text, this.deps.config.maxOutputBytes);
      return {
        documentId: input.documentId,
        manifest: entry.manifest,
        text,
        completeText: page.text,
        lines: page.lines.slice(0, 200),
        page: input.page,
        truncated: text !== page.text,
      };
    }

    const startLine = input.startLine!;
    const lineCount = input.lineCount ?? DEFAULT_LINE_COUNT;
    const lines = entry.pages.flatMap((page) => page.lines);
    const startIndex = startLine - 1;
    const window = lines.slice(startIndex, startIndex + lineCount);
    if (window.length === 0) throw new Error(`Line ${startLine} out of range`);
    const fullText = window.map((line) => `${line.lineNumber}: ${line.text}`).join("\n");
    const text = truncateForOutput(fullText, this.deps.config.maxOutputBytes);
    return {
      documentId: input.documentId,
      manifest: entry.manifest,
      text,
      completeText: fullText,
      lines: window,
      truncated: text !== fullText,
    };
  }

  async search(
    input: QuerySearchInput,
    _ctx: ToolContext,
    signal?: AbortSignal,
  ): Promise<QuerySearchOutcome> {
    ensureNotAborted(signal);
    validateSearchInput(input);
    const entry = await loadDocumentOrThrow(this.deps.cache, input.documentId);
    ensureNotAborted(signal);
    const adapter = await loadNativeAdapterOrThrow(this.deps.nativeLoader).catch((error) => {
      throw new Error(
        `Parse native module is unavailable for spatial search; read remains supported: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    });
    if (!adapter.searchItems) {
      throw new Error(
        "Parse native module is unavailable for spatial search; read remains supported",
      );
    }

    const maxResults = Math.min(
      this.deps.config.maxSearchResults,
      input.maxResults ?? this.deps.config.maxSearchResults,
    );
    const contextChars = Math.min(input.contextChars ?? DEFAULT_CONTEXT_CHARS, 2_000);
    const matches: QuerySearchMatch[] = [];

    for (const page of entry.textItems) {
      ensureNotAborted(signal);
      const pageMatches = adapter.searchItems(page.textItems, {
        phrase: input.phrase,
        caseSensitive: input.caseSensitive ?? false,
      } satisfies SearchItemsOptions);
      for (const item of pageMatches) {
        matches.push({
          pageNum: page.pageNum,
          text: item.text,
          pageLineNumber: locatePageLine(entry.pages, page.pageNum, item.text),
          x: item.x,
          y: item.y,
          width: item.width,
          height: item.height,
          confidence: item.confidence,
          context: sliceContext(findPageText(entry.pages, page.pageNum), item.text, contextChars),
        });
        if (matches.length >= maxResults) {
          return {
            documentId: input.documentId,
            manifest: entry.manifest,
            phrase: input.phrase,
            matches,
            truncated: true,
          };
        }
      }
    }

    return {
      documentId: input.documentId,
      manifest: entry.manifest,
      phrase: input.phrase,
      matches,
      truncated: false,
    };
  }

  async screenshot(
    input: ScreenshotToolInput,
    ctx: ToolContext,
    signal?: AbortSignal,
    progress?: (phase: string, message: string) => void,
  ): Promise<ScreenshotOutcome> {
    ensureNotAborted(signal);
    validateScreenshotInput(input, this.deps.config.maxScreenshots);
    const entry = await loadDocumentOrThrow(this.deps.cache, input.documentId);
    if (entry.manifest.source.plainText)
      throw new Error("Screenshots are only available for non-text documents");

    progress?.("validating", "Revalidating source");
    await ensureSourceHash(entry.manifest.source.realPath, entry.manifest.source.sha256);

    const dpi = input.dpi ?? this.deps.config.defaultDpi;
    if (!isFinitePositiveInteger(dpi) || dpi > this.deps.config.maxDpi) {
      throw new Error(`dpi must be a positive integer <= ${this.deps.config.maxDpi}`);
    }

    const adapter = await loadNativeAdapterOrThrow(this.deps.nativeLoader);
    progress?.("rendering", "Rendering screenshots");
    const native = adapter.create(buildScreenshotNativeConfig(this.deps.config, dpi));
    const results = await native.screenshot(entry.manifest.source.realPath, input.pages);
    ensureNotAborted(signal);

    const screenshotBuffers: Record<string, Buffer> = {};
    const pageRecords: Array<{
      pageNum: number;
      path: string;
      bytes: number;
      width: number;
      height: number;
    }> = [];
    const screenshots: Record<string, { path: string; bytes: number }> = {};
    for (const shot of results) {
      const key = screenshotKey(shot.pageNum, dpi);
      const relPath = path.join("screenshots", `${key}.png`);
      screenshotBuffers[key] = shot.imageBuffer;
      screenshots[key] = { path: relPath, bytes: shot.imageBuffer.length };
      pageRecords.push({
        pageNum: shot.pageNum,
        path: path.join(this.deps.config.cacheDir, input.documentId, relPath),
        bytes: shot.imageBuffer.length,
        width: shot.width,
        height: shot.height,
      });
    }

    const updated: DocumentCacheEntry = {
      ...entry,
      manifest: {
        ...entry.manifest,
        lastAccessedAt: new Date().toISOString(),
        artifacts: {
          ...entry.manifest.artifacts,
          screenshots: {
            ...entry.manifest.artifacts.screenshots,
            ...screenshots,
          },
        },
      },
      screenshotBuffers,
    };

    progress?.("writing-cache", "Writing cache");
    const stored = await persistEntryUnlessAborted(this.deps.cache, updated, signal);
    const images =
      input.includeImages !== false && modelHasImageInput(ctx.model)
        ? pageRecords.map((page) => ({
            type: "image" as const,
            data: screenshotBuffers[screenshotKey(page.pageNum, dpi)].toString("base64"),
            mimeType: "image/png" as const,
          }))
        : undefined;

    return {
      documentId: input.documentId,
      manifest: stored.manifest,
      pages: pageRecords,
      images,
    };
  }
}

export function classifySourceKind(ext: string): SourceKind {
  if (PLAIN_TEXT_EXTS.has(ext)) return "plain-text";
  if (PDF_EXTS.has(ext)) return "pdf";
  if (OFFICE_EXTS.has(ext)) return "office";
  if (PRESENTATION_EXTS.has(ext)) return "presentation";
  if (SPREADSHEET_EXTS.has(ext)) return "spreadsheet";
  if (IMAGE_EXTS.has(ext)) return "image";
  return "unsupported";
}

export async function resolveSource(
  inputPath: string,
  cwd: string,
  maxInputBytes: number,
): Promise<SourceResolution> {
  if (!inputPath || typeof inputPath !== "string") throw new Error("path is required");
  if (/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(inputPath) || inputPath.includes("://")) {
    throw new Error("Only local filesystem paths are supported");
  }
  const resolvedPath = path.isAbsolute(inputPath) ? inputPath : path.resolve(cwd, inputPath);
  const realPath = await realpath(resolvedPath);
  const st = await stat(realPath);
  if (!st.isFile()) throw new Error("Source must be a regular file");
  if (st.size <= 0) throw new Error("Source file is empty");
  if (st.size > maxInputBytes)
    throw new Error(`Source exceeds maxInputBytes (${st.size} > ${maxInputBytes})`);
  const ext = path.extname(realPath).toLowerCase();
  const kind = classifySourceKind(ext);
  if (kind === "unsupported") throw new Error(`Unsupported source extension: ${ext || "<none>"}`);
  return {
    inputPath,
    cwd,
    resolvedPath,
    realPath,
    size: st.size,
    sha256: "",
    ext,
    kind,
    plainText: kind === "plain-text",
  };
}

export function resolveParseSettings(config: ResolvedConfig, input: ParseToolInput) {
  const format = validateFormat(input.format ?? "text");
  const ocrMode = validateOcrMode(input.ocrMode ?? config.ocrMode);
  const maxPages =
    input.maxPages === undefined
      ? config.maxPages
      : validatePositiveInteger(input.maxPages, "maxPages", config.maxPages);
  const dpi =
    input.dpi === undefined
      ? config.defaultDpi
      : validatePositiveInteger(input.dpi, "dpi", config.maxDpi);
  const imageMode = validateImageMode(input.imageMode ?? "placeholder");
  const cropBox = input.cropBox === undefined ? undefined : validateCropBox(input.cropBox);
  const ocrLanguage =
    input.ocrLanguage === undefined ? config.ocrLanguage : input.ocrLanguage.trim();
  if (ocrLanguage.length === 0) throw new Error("ocrLanguage must be a non-empty string");
  const targetPages = input.targetPages === undefined ? undefined : input.targetPages.trim();
  if (targetPages !== undefined) validateTargetPages(targetPages, maxPages);

  return {
    format,
    ocrMode,
    ocrLanguage,
    targetPages,
    maxPages,
    dpi,
    imageMode,
    extractLinks: input.extractLinks ?? true,
    preserveVerySmallText: input.preserveVerySmallText ?? false,
    emitWordBoxes: input.emitWordBoxes ?? false,
    skipDiagonalText: input.skipDiagonalText ?? false,
    includeComplexity: input.includeComplexity ?? false,
    cropBox,
    force: input.force ?? false,
  };
}

export function buildCacheKey(
  config: ResolvedConfig,
  source: SourceResolution,
  settings: ReturnType<typeof resolveParseSettings>,
) {
  const payload = {
    schemaVersion: SCHEMA_VERSION,
    packageVersion: config.packageVersion,
    source: {
      sha256: source.sha256,
      size: source.size,
      kind: source.kind,
      plainText: source.plainText,
    },
    settings: compactObject({
      format: settings.format,
      ocrMode: settings.ocrMode,
      ocrLanguage: settings.ocrLanguage,
      targetPages: settings.targetPages,
      maxPages: settings.maxPages,
      dpi: settings.dpi,
      imageMode: settings.imageMode,
      extractLinks: settings.extractLinks,
      preserveVerySmallText: settings.preserveVerySmallText,
      emitWordBoxes: settings.emitWordBoxes,
      skipDiagonalText: settings.skipDiagonalText,
      includeComplexity: settings.includeComplexity,
      cropBox: settings.cropBox,
      ocrFailureFatal: config.ocrFailureFatal,
      ocrHedgeDelaysMs: config.ocrHedgeDelaysMs,
      ocrServerUrl: config.ocrServerUrl,
      tessdataPath: config.tessdataPath,
      secretFingerprint: config.secrets.fingerprint,
    }),
  };
  const cacheKey = stableStringify(payload);
  return { cacheKey, cacheKeyHash: sha256Hex(cacheKey) };
}

export function buildDocumentId(cacheKeyHash: string): string {
  return sha256Prefix(cacheKeyHash, 24);
}

function buildPlainTextDocument(params: {
  config: ResolvedConfig;
  source: SourceResolution;
  settings: ReturnType<typeof resolveParseSettings>;
  bytes: Buffer;
  cacheKey: { cacheKey: string; cacheKeyHash: string };
  documentId: string;
}): { entry: DocumentCacheEntry } {
  const text = params.bytes.toString("utf8");
  const linesRaw = splitLines(text);
  const pageWidth = Math.max(1, ...linesRaw.map((line) => line.length * 7));
  const pageHeight = Math.max(1, linesRaw.length * 12);
  const lines: PageLineArtifact[] = [];
  const textItems: NativeTextItem[] = [];
  let offset = 0;
  linesRaw.forEach((line, index) => {
    const lineNumber = index + 1;
    lines.push({
      lineNumber,
      pageNum: 1,
      pageLineNumber: lineNumber,
      text: line,
      startOffset: offset,
      endOffset: offset + line.length,
    });
    textItems.push({
      text: line,
      x: 0,
      y: index * 12,
      width: Math.max(1, line.length * 7),
      height: 12,
      confidence: 1,
    });
    offset += line.length + 1;
  });

  const pages: PageArtifact[] = [
    {
      pageNum: 1,
      width: pageWidth,
      height: pageHeight,
      text,
      lines,
      textItems,
    },
  ];
  const textItemsPages: TextItemPageArtifact[] = [{ pageNum: 1, textItems }];
  const documentJson =
    params.settings.format === "json"
      ? JSON.stringify({ pageCount: 1, pages: [{ pageNum: 1, text }] }, null, 2)
      : undefined;
  const manifest = buildManifest({
    config: params.config,
    source: params.source,
    settings: params.settings,
    pageCount: 1,
    documentText: text,
    documentMarkdown: undefined,
    documentJson,
    pages,
    textItems: textItemsPages,
    cacheKeyHash: params.cacheKey.cacheKeyHash,
    cacheKey: params.cacheKey.cacheKey,
    ocrModeResolved: "off",
  });
  return {
    entry: { manifest, documentText: text, documentJson, pages, textItems: textItemsPages },
  };
}

function buildNativeDocument(params: {
  source: SourceResolution;
  settings: ReturnType<typeof resolveParseSettings>;
  result: NativeParseResult;
  complexity: NativePageComplexityStats[] | undefined;
  config: ResolvedConfig;
  packageVersion: string;
  ocrResolved: "on" | "off";
  cacheKey: { cacheKey: string; cacheKeyHash: string };
  documentId: string;
}): { entry: DocumentCacheEntry } {
  const pages = buildPages(params.result.pages, params.complexity);
  const textItems = params.result.pages.map((page) => ({
    pageNum: page.pageNum,
    textItems: page.textItems,
  }));
  const documentText = pages.map((page) => page.text).join("\n");
  const documentMarkdown = params.settings.format === "markdown" ? params.result.text : undefined;
  const documentJson = params.settings.format === "json" ? params.result.text : undefined;
  const imageBuffers = Object.fromEntries(
    params.result.images.map((image) => [image.id, { format: image.format, buffer: image.bytes }]),
  );
  const manifest = buildManifest({
    config: params.config,
    source: params.source,
    settings: params.settings,
    pageCount: pages.length,
    documentText,
    documentMarkdown,
    documentJson,
    pages,
    textItems,
    cacheKeyHash: params.cacheKey.cacheKeyHash,
    cacheKey: params.cacheKey.cacheKey,
    ocrModeResolved: params.ocrResolved,
  });
  return {
    entry: {
      manifest,
      documentText,
      documentMarkdown,
      documentJson,
      pages,
      textItems,
      imageBuffers: Object.keys(imageBuffers).length > 0 ? imageBuffers : undefined,
    },
  };
}

function buildPages(
  pages: NativeParsedPage[],
  complexity: NativePageComplexityStats[] | undefined,
): PageArtifact[] {
  let globalLine = 1;
  let globalOffset = 0;
  return pages.map((page, index) => {
    const pageText = page.text ?? "";
    const linesRaw = splitLines(pageText);
    const lines: PageLineArtifact[] = [];
    let localOffset = 0;
    linesRaw.forEach((line, lineIndex) => {
      const startOffset = globalOffset + localOffset;
      lines.push({
        lineNumber: globalLine++,
        pageNum: page.pageNum,
        pageLineNumber: lineIndex + 1,
        text: line,
        startOffset,
        endOffset: startOffset + line.length,
      });
      localOffset += line.length + 1;
    });
    globalOffset += pageText.length + (index < pages.length - 1 ? 1 : 0);
    return {
      pageNum: page.pageNum,
      width: page.width,
      height: page.height,
      text: pageText,
      markdown: page.markdown,
      complexity: complexity?.find((item) => item.pageNumber === page.pageNum) ?? page.complexity,
      lines,
      textItems: page.textItems,
    };
  });
}

function buildManifest(params: {
  config: ResolvedConfig;
  source: SourceResolution;
  settings: ReturnType<typeof resolveParseSettings>;
  pageCount: number;
  documentText: string;
  documentMarkdown?: string;
  documentJson?: string;
  pages: PageArtifact[];
  textItems: TextItemPageArtifact[];
  cacheKeyHash: string;
  cacheKey: string;
  ocrModeResolved: "on" | "off";
}): CacheManifest {
  return {
    schemaVersion: SCHEMA_VERSION,
    documentId: buildDocumentId(params.cacheKeyHash),
    cacheKey: params.cacheKey,
    cacheKeyHash: params.cacheKeyHash,
    source: {
      inputPath: params.source.inputPath,
      resolvedPath: params.source.resolvedPath,
      realPath: params.source.realPath,
      size: params.source.size,
      sha256: params.source.sha256,
      kind: params.source.kind,
      ext: params.source.ext,
      plainText: params.source.plainText,
    },
    createdAt: new Date().toISOString(),
    lastAccessedAt: new Date().toISOString(),
    packageVersion: params.config.packageVersion,
    sourceHash: params.source.sha256,
    pageCount: params.pageCount,
    redactedConfig: compactObject({
      format: params.settings.format,
      ocrModeRequested: params.settings.ocrMode,
      ocrModeResolved: params.ocrModeResolved,
      ocrLanguage: params.settings.ocrLanguage,
      targetPages: params.settings.targetPages,
      maxPages: params.settings.maxPages,
      dpi: params.settings.dpi,
      imageMode: params.settings.imageMode,
      extractLinks: params.settings.extractLinks,
      preserveVerySmallText: params.settings.preserveVerySmallText,
      emitWordBoxes: params.settings.emitWordBoxes,
      skipDiagonalText: params.settings.skipDiagonalText,
      includeComplexity: params.settings.includeComplexity,
      cropBox: params.settings.cropBox,
      ocrServerUrl: params.config.ocrServerUrl,
      tessdataPath: params.config.tessdataPath,
      passwordEnv: params.config.passwordEnv,
      ocrServerHeadersEnv: params.config.ocrServerHeadersEnv,
      secretFingerprint: params.config.secrets.fingerprint,
    }),
    artifacts: buildArtifactSet(
      params.documentText,
      params.documentMarkdown,
      params.documentJson,
      params.pages,
      params.textItems,
      undefined,
    ),
    cacheBytes: 0,
  };
}

function buildArtifactSet(
  documentText: string,
  documentMarkdown: string | undefined,
  documentJson: string | undefined,
  pages: PageArtifact[],
  textItems: TextItemPageArtifact[],
  screenshots: Record<string, Buffer> | undefined,
) {
  return {
    documentText: { path: "document.txt", bytes: utf8ByteLength(documentText) },
    documentMarkdown:
      documentMarkdown !== undefined
        ? { path: "document.md", bytes: utf8ByteLength(documentMarkdown) }
        : undefined,
    documentJson:
      documentJson !== undefined
        ? { path: "document.json", bytes: utf8ByteLength(documentJson) }
        : undefined,
    pages: {
      path: "pages.json.gz",
      bytes: Buffer.byteLength(JSON.stringify(pages), "utf8"),
    },
    textItems: {
      path: "textitems.json.gz",
      bytes: Buffer.byteLength(JSON.stringify(textItems), "utf8"),
    },
    images: {},
    screenshots: screenshots
      ? Object.fromEntries(
          Object.entries(screenshots).map(([key, buffer]) => [
            key,
            {
              path: path.join("screenshots", `${key}.png`),
              bytes: buffer.length,
            },
          ]),
        )
      : {},
  };
}

function buildParseOutcome(params: {
  documentId: string;
  cacheDir: string;
  cacheHit: boolean;
  manifest: CacheManifest;
  documentText: string;
  documentMarkdown?: string;
  documentJson?: string;
  pages: PageArtifact[];
  textItems: TextItemPageArtifact[];
  preview: string;
  ocrModeRequested: OcrMode;
  ocrModeResolved: "on" | "off";
  complexity?: NativePageComplexityStats[];
  nativeLoadError?: string;
}): ParseOutcome {
  return {
    documentId: params.documentId,
    cacheHit: params.cacheHit,
    manifest: params.manifest,
    preview: params.preview,
    documentText: params.documentText,
    documentMarkdown: params.documentMarkdown,
    documentJson: params.documentJson,
    pages: params.pages,
    textItems: params.textItems,
    complexity: params.complexity,
    ocrModeRequested: params.ocrModeRequested,
    ocrModeResolved: params.ocrModeResolved,
    artifactPaths: artifactPaths(params.cacheDir, params.documentId, params.manifest.artifacts),
    nativeLoadError: params.nativeLoadError,
  };
}

function artifactPaths(
  cacheDir: string,
  documentId: string,
  artifacts: CacheManifest["artifacts"],
): string[] {
  return [
    artifacts.documentText,
    artifacts.documentMarkdown,
    artifacts.documentJson,
    artifacts.pages,
    artifacts.textItems,
    ...Object.values(artifacts.images),
    ...Object.values(artifacts.screenshots),
  ]
    .filter((item): item is NonNullable<typeof item> => Boolean(item))
    .map((item) => path.join(cacheDir, documentId, item.path));
}

function cacheEntryMatches(
  manifest: CacheManifest,
  cacheKey: string,
  cacheKeyHash: string,
  source: SourceResolution,
  packageVersion: string,
): boolean {
  return (
    manifest.cacheKey === cacheKey &&
    manifest.cacheKeyHash === cacheKeyHash &&
    manifest.packageVersion === packageVersion &&
    manifest.source.sha256 === source.sha256 &&
    manifest.source.size === source.size &&
    manifest.source.realPath === source.realPath
  );
}

function validateFormat(format: unknown): SupportedFormat {
  if (format === "text" || format === "markdown" || format === "json") return format;
  throw new Error("format must be text, markdown, or json");
}

function validateOcrMode(mode: unknown): OcrMode {
  if (mode === "auto" || mode === "on" || mode === "off") return mode;
  throw new Error("ocrMode must be auto, on, or off");
}

function validateImageMode(mode: unknown): ImageMode {
  if (mode === "off" || mode === "placeholder" || mode === "embed") return mode;
  throw new Error("imageMode must be off, placeholder, or embed");
}

function validatePositiveInteger(value: unknown, name: string, max: number): number {
  if (!isFinitePositiveInteger(value)) throw new Error(`${name} must be a positive integer`);
  if (value > max) throw new Error(`${name} must be <= ${max}`);
  return value;
}

function validateTargetPages(targetPages: string, maxPages: number): void {
  if (!/^\d+(?:-\d+)?(?:,\d+(?:-\d+)?)*$/.test(targetPages)) {
    throw new Error('targetPages must look like "1-5,10"');
  }
  const selected = new Set<number>();
  for (const part of targetPages.split(",")) {
    const [startRaw, endRaw] = part.split("-");
    const start = Number(startRaw);
    const end = endRaw === undefined ? start : Number(endRaw);
    if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 1 || end < start) {
      throw new Error("targetPages ranges must be positive and ascending");
    }
    if (end > 1_000_000) throw new Error("targetPages contains an unreasonable page number");
    for (let page = start; page <= end; page += 1) {
      selected.add(page);
      if (selected.size > maxPages) {
        throw new Error(`targetPages selects more than maxPages (${maxPages})`);
      }
    }
  }
}

function validateCropBox(cropBox: CropBox): CropBox {
  for (const value of [cropBox.top, cropBox.right, cropBox.bottom, cropBox.left]) {
    if (!isFinitePositiveNumber(value) && value !== 0)
      throw new Error("cropBox values must be fractions in [0, 1]");
    if (value < 0 || value > 1) throw new Error("cropBox values must be fractions in [0, 1]");
  }
  if (cropBox.top + cropBox.bottom >= 1 || cropBox.left + cropBox.right >= 1) {
    throw new Error("cropBox top+bottom and left+right must each be < 1");
  }
  return cropBox;
}

function ensureNotAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw abortError();
}

async function persistEntryUnlessAborted(
  cache: CacheStore,
  entry: DocumentCacheEntry,
  signal?: AbortSignal,
): Promise<DocumentCacheEntry> {
  const stored = await cache.put(entry);
  if (signal?.aborted) {
    await cache.delete(stored.manifest.documentId).catch(() => undefined);
    throw abortError();
  }
  return stored;
}

async function loadNativeAdapterOrThrow(
  loader: LiteparseServiceDeps["nativeLoader"],
): Promise<NativeAdapter> {
  try {
    return await loader.load();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(
      `Parse native module failed to load: ${message}. Run /parseview-doctor for diagnostics.`,
    );
  }
}

async function loadDocumentOrThrow(
  cache: CacheStore,
  documentId: string,
): Promise<DocumentCacheEntry> {
  validateDocumentId(documentId);
  const entry = await cache.get(documentId);
  if (!entry) throw new Error(`Document ${documentId} not found or cache entry is stale/corrupt`);
  return entry;
}

function validateDocumentId(documentId: string): void {
  if (!/^[0-9a-f]{24,64}$/.test(documentId)) throw new Error("Invalid documentId");
}

function validateReadInput(input: QueryReadInput): void {
  if (
    input.page !== undefined &&
    (input.startLine !== undefined || input.lineCount !== undefined)
  ) {
    throw new Error("read by page cannot include startLine or lineCount");
  }
  if (input.page === undefined && input.startLine === undefined) {
    throw new Error("read requires page or startLine");
  }
  if (input.page !== undefined && !isFinitePositiveInteger(input.page))
    throw new Error("page must be a positive integer");
  if (input.startLine !== undefined && !isFinitePositiveInteger(input.startLine))
    throw new Error("startLine must be a positive integer");
  if (
    input.lineCount !== undefined &&
    (!isFinitePositiveInteger(input.lineCount) || input.lineCount > 200)
  )
    throw new Error("lineCount must be a positive integer <= 200");
}

function validateSearchInput(input: QuerySearchInput): void {
  if (!input.phrase || typeof input.phrase !== "string")
    throw new Error("phrase is required for search");
  if (input.caseSensitive !== undefined && typeof input.caseSensitive !== "boolean")
    throw new Error("caseSensitive must be boolean");
  if (input.maxResults !== undefined && !isFinitePositiveInteger(input.maxResults))
    throw new Error("maxResults must be a positive integer");
  if (
    input.contextChars !== undefined &&
    (!isFiniteNonNegativeInteger(input.contextChars) || input.contextChars > 2_000)
  )
    throw new Error("contextChars must be a non-negative integer <= 2000");
}

function validateScreenshotInput(input: ScreenshotToolInput, maxScreenshots: number): void {
  if (!Array.isArray(input.pages) || input.pages.length === 0)
    throw new Error("At least one page is required");
  if (input.pages.length > maxScreenshots)
    throw new Error(`pages exceeds maxScreenshots (${input.pages.length} > ${maxScreenshots})`);
  const seen = new Set<number>();
  for (const page of input.pages) {
    if (!isFinitePositiveInteger(page)) throw new Error("pages must be positive integers");
    if (seen.has(page)) throw new Error("pages must be unique");
    seen.add(page);
  }
}

function previewDocument(
  format: SupportedFormat,
  documentText: string,
  documentMarkdown: string | undefined,
  documentJson: string | undefined,
  maxOutputBytes: number,
): string {
  const source =
    format === "markdown" && documentMarkdown !== undefined
      ? documentMarkdown
      : format === "json" && documentJson !== undefined
        ? documentJson
        : documentText;
  return truncateForOutput(source, maxOutputBytes);
}

function truncateForOutput(text: string, maxBytes: number): string {
  return truncateUtf8WithEllipsis(text, maxBytes).text;
}

function splitLines(text: string): string[] {
  return text.split(/\r?\n/);
}

function extractComplexity(pages: PageArtifact[]): NativePageComplexityStats[] | undefined {
  const complexity = pages
    .map((page) => page.complexity)
    .filter((value): value is NativePageComplexityStats => Boolean(value));
  return complexity.length > 0 ? complexity : undefined;
}

function locatePageLine(pages: PageArtifact[], pageNum: number, text: string): number | undefined {
  const page = pages.find((candidate) => candidate.pageNum === pageNum);
  return page?.lines.find((line) => line.text.includes(text))?.pageLineNumber;
}

function findPageText(pages: PageArtifact[], pageNum: number): string {
  return pages.find((candidate) => candidate.pageNum === pageNum)?.text ?? "";
}

function sliceContext(text: string, needle: string, contextChars: number): string | undefined {
  const index = text.indexOf(needle);
  if (index < 0) return undefined;
  const start = Math.max(0, index - contextChars);
  const end = Math.min(text.length, index + needle.length + contextChars);
  return text.slice(start, end);
}

function screenshotKey(pageNum: number, dpi: number): string {
  return `page-${pageNum}-${dpi}`;
}

function modelHasImageInput(model: ToolContext["model"]): boolean {
  return Boolean(model?.input && Array.isArray(model.input) && model.input.includes("image"));
}

function buildNativeConfig(
  config: ResolvedConfig,
  settings: ReturnType<typeof resolveParseSettings>,
  ocrEnabled: boolean,
): Record<string, unknown> {
  return compactObject({
    ocrLanguage: settings.ocrLanguage,
    ocrEnabled,
    ocrServerUrl: config.ocrServerUrl,
    ocrServerHeaders: config.secrets.ocrServerHeaders,
    tessdataPath: config.tessdataPath,
    maxPages: settings.maxPages,
    targetPages: settings.targetPages,
    dpi: settings.dpi,
    outputFormat: settings.format,
    imageMode: settings.imageMode,
    extractLinks: settings.extractLinks,
    preserveVerySmallText: settings.preserveVerySmallText,
    password: config.secrets.password,
    quiet: true,
    numWorkers: 1,
    ocrFailureFatal: config.ocrFailureFatal,
    ocrHedgeDelaysMs: config.ocrHedgeDelaysMs,
    emitWordBoxes: settings.emitWordBoxes,
    cropBox: settings.cropBox,
    skipDiagonalText: settings.skipDiagonalText,
    includeComplexity: settings.includeComplexity,
  });
}

function buildScreenshotNativeConfig(config: ResolvedConfig, dpi: number): Record<string, unknown> {
  return compactObject({
    ocrLanguage: config.ocrLanguage,
    ocrEnabled: false,
    ocrServerUrl: config.ocrServerUrl,
    ocrServerHeaders: config.secrets.ocrServerHeaders,
    tessdataPath: config.tessdataPath,
    maxPages: config.maxPages,
    dpi,
    outputFormat: "text",
    imageMode: "off",
    extractLinks: true,
    preserveVerySmallText: false,
    password: config.secrets.password,
    quiet: true,
    numWorkers: 1,
    ocrFailureFatal: config.ocrFailureFatal,
    ocrHedgeDelaysMs: config.ocrHedgeDelaysMs,
    emitWordBoxes: false,
    skipDiagonalText: false,
    includeComplexity: false,
  });
}

async function ensureSourceHash(sourcePath: string, expectedHash: string): Promise<void> {
  const bytes = await readFile(sourcePath);
  const actual = sha256Hex(bytes);
  if (actual !== expectedHash) throw new Error("Source file changed since cache entry was created");
}
