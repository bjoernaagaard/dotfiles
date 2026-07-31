export type OcrMode = "auto" | "on" | "off";
export type SupportedFormat = "text" | "markdown" | "json";
export type ImageMode = "off" | "placeholder" | "embed";

export interface CropBox {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

export type SourceKind =
  | "plain-text"
  | "pdf"
  | "office"
  | "presentation"
  | "spreadsheet"
  | "image"
  | "unsupported";

export interface LiteparseFileConfig {
  cacheDir: string;
  maxInputBytes: number;
  maxPages: number;
  maxDpi: number;
  defaultDpi: number;
  maxScreenshots: number;
  maxOutputBytes: number;
  maxSearchResults: number;
  maxDocumentCacheBytes: number;
  maxTotalCacheBytes: number;
  ocrMode: OcrMode;
  ocrLanguage: string;
  ocrFailureFatal: boolean;
  ocrHedgeDelaysMs: number[];
  ocrServerUrl?: string;
  tessdataPath?: string;
  passwordEnv?: string;
  ocrServerHeadersEnv?: string;
}

export interface ResolvedSecrets {
  password?: string;
  ocrServerHeaders?: Record<string, string>;
  fingerprint: string;
}

export interface ResolvedConfig extends LiteparseFileConfig {
  cacheDirRealPath: string;
  packageVersion: string;
  secrets: ResolvedSecrets;
}

export interface SourceResolution {
  inputPath: string;
  cwd: string;
  resolvedPath: string;
  realPath: string;
  size: number;
  sha256: string;
  ext: string;
  kind: SourceKind;
  plainText: boolean;
}

export interface ParseToolInput {
  path: string;
  format?: SupportedFormat;
  ocrMode?: OcrMode;
  ocrLanguage?: string;
  targetPages?: string;
  maxPages?: number;
  dpi?: number;
  imageMode?: ImageMode;
  extractLinks?: boolean;
  preserveVerySmallText?: boolean;
  emitWordBoxes?: boolean;
  skipDiagonalText?: boolean;
  includeComplexity?: boolean;
  cropBox?: CropBox;
  force?: boolean;
}

export interface QueryReadInput {
  action: "read";
  documentId: string;
  page?: number;
  startLine?: number;
  lineCount?: number;
}

export interface QuerySearchInput {
  action: "search";
  documentId: string;
  phrase: string;
  caseSensitive?: boolean;
  maxResults?: number;
  contextChars?: number;
}

export type QueryToolInput = QueryReadInput | QuerySearchInput;

export interface ScreenshotToolInput {
  documentId: string;
  pages: number[];
  dpi?: number;
  includeImages?: boolean;
}

export interface PageLineArtifact {
  lineNumber: number;
  pageNum: number;
  pageLineNumber: number;
  text: string;
  startOffset: number;
  endOffset: number;
}

export interface PageArtifact {
  pageNum: number;
  width: number;
  height: number;
  text: string;
  markdown?: string;
  complexity?: NativePageComplexityStats;
  lines: PageLineArtifact[];
  textItems: NativeTextItem[];
}

export interface TextItemPageArtifact {
  pageNum: number;
  textItems: NativeTextItem[];
}

export interface ArtifactFileInfo {
  path: string;
  bytes: number;
  sha256?: string;
}

export interface ArtifactSet {
  documentText: ArtifactFileInfo;
  documentMarkdown?: ArtifactFileInfo;
  documentJson?: ArtifactFileInfo;
  pages: ArtifactFileInfo;
  textItems: ArtifactFileInfo;
  images: Record<string, ArtifactFileInfo>;
  screenshots: Record<string, ArtifactFileInfo>;
}

export interface CacheManifest {
  schemaVersion: number;
  documentId: string;
  cacheKey: string;
  cacheKeyHash: string;
  source: {
    inputPath: string;
    resolvedPath: string;
    realPath: string;
    size: number;
    sha256: string;
    kind: SourceKind;
    ext: string;
    plainText: boolean;
  };
  createdAt: string;
  lastAccessedAt: string;
  packageVersion: string;
  sourceHash: string;
  pageCount: number;
  redactedConfig: Record<string, unknown>;
  artifacts: ArtifactSet;
  cacheBytes: number;
}

export interface DocumentCacheEntry {
  manifest: CacheManifest;
  documentText: string;
  documentMarkdown?: string;
  documentJson?: string;
  pages: PageArtifact[];
  textItems: TextItemPageArtifact[];
  imageBuffers?: Record<string, { format: string; buffer: Buffer }>;
  screenshotBuffers?: Record<string, Buffer>;
}

export interface CacheStatus {
  entryCount: number;
  bytes: number;
}

export interface ParseOutcome {
  documentId: string;
  cacheHit: boolean;
  manifest: CacheManifest;
  preview: string;
  documentText: string;
  documentMarkdown?: string;
  documentJson?: string;
  pages: PageArtifact[];
  textItems: TextItemPageArtifact[];
  complexity?: NativePageComplexityStats[];
  ocrModeRequested: OcrMode;
  ocrModeResolved: "on" | "off";
  artifactPaths: string[];
  nativeLoadError?: string;
}

export interface QueryReadOutcome {
  documentId: string;
  manifest: CacheManifest;
  /** Text after the document service's configured byte ceiling is applied. */
  text: string;
  /** Complete text for the requested page or line window, retained for lossless recovery. */
  completeText: string;
  lines: PageLineArtifact[];
  page?: number;
  /** True when the document service applied its configured byte ceiling before tool formatting. */
  truncated?: boolean;
}

export interface QuerySearchMatch {
  pageNum: number;
  text: string;
  pageLineNumber?: number;
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  confidence?: number;
  context?: string;
}

export interface QuerySearchOutcome {
  documentId: string;
  manifest: CacheManifest;
  phrase: string;
  matches: QuerySearchMatch[];
  truncated: boolean;
}

export interface ScreenshotOutcome {
  documentId: string;
  manifest: CacheManifest;
  pages: Array<{
    pageNum: number;
    path: string;
    bytes: number;
    width: number;
    height: number;
  }>;
  images?: Array<{ type: "image"; data: string; mimeType: "image/png" }>;
}

export interface NativeWordBox {
  text: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface NativeTextItem {
  text: string;
  x: number;
  y: number;
  width: number;
  height: number;
  fontName?: string;
  fontSize?: number;
  confidence?: number;
  rotation?: number;
  words?: NativeWordBox[];
}

export interface NativeGraphic {
  kind: string;
  x1?: number;
  y1?: number;
  x2?: number;
  y2?: number;
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  hasFill?: boolean;
  hasStroke?: boolean;
  fillColor?: string;
  strokeColor?: string;
  lineWidth?: number;
}

export interface NativePageInput {
  pageNumber: number;
  pageWidth: number;
  pageHeight: number;
  textItems: NativeTextItem[];
  graphics?: NativeGraphic[];
}

export interface NativeParsedPage {
  pageNum: number;
  width: number;
  height: number;
  text: string;
  markdown?: string;
  textItems: NativeTextItem[];
  complexity?: NativePageComplexityStats;
}

export interface NativeExtractedImage {
  id: string;
  page: number;
  format: string;
  bytes: Buffer;
}

export interface NativeParseResult {
  pages: NativeParsedPage[];
  text: string;
  images: NativeExtractedImage[];
}

export interface NativeScreenshotResult {
  pageNum: number;
  width: number;
  height: number;
  imageBuffer: Buffer;
}

export interface NativePageComplexityStats {
  pageNumber: number;
  textLength: number;
  textCoverage: number;
  hasSubstantialImages: boolean;
  imageBlockCount: number;
  imageCoverage: number;
  largestImageCoverage: number;
  fullPageImage: boolean;
  uncoveredVectorArea?: number;
  isGarbled: boolean;
  pageArea: number;
  needsOcr: boolean;
  reasons: string[];
}

export interface NativeInstance {
  parse(input: string | Buffer): Promise<NativeParseResult>;
  isComplex(input: string | Buffer): Promise<NativePageComplexityStats[]>;
  screenshot(
    input: string | Buffer,
    pageNumbers?: number[] | null,
  ): Promise<NativeScreenshotResult[]>;
  format(result: NativeParseResult): string;
  readonly config: Record<string, unknown>;
}

export interface SearchItemsOptions {
  phrase: string;
  caseSensitive?: boolean | null;
}

export interface NativeAdapter {
  version: string;
  create(config: Record<string, unknown>): NativeInstance;
  searchItems?: (items: NativeTextItem[], options: SearchItemsOptions) => NativeTextItem[];
}

export interface NativeLoader {
  load(): Promise<NativeAdapter>;
  getLastError(): Error | undefined;
  getLastVersion(): string | undefined;
}

export interface CacheStore {
  get(documentId: string): Promise<DocumentCacheEntry | undefined>;
  put(entry: DocumentCacheEntry): Promise<DocumentCacheEntry>;
  touch(documentId: string, manifest: CacheManifest): Promise<void>;
  delete(documentId: string): Promise<void>;
  status(): Promise<CacheStatus>;
  clear(): Promise<void>;
}

export interface LiteparseServiceDeps {
  config: ResolvedConfig;
  cache: CacheStore;
  nativeLoader: NativeLoader;
}

export interface ToolContext {
  cwd: string;
  hasUI?: boolean;
  model?: { input?: string[] };
}
