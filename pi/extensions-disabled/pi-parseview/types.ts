export interface PreviewOptions {
  content?: string;
  filePath?: string;
  format: "terminal" | "browser" | "pdf";
  fontSizePx?: number;
  outputPath?: string;
}

export interface ParseOptions {
  path: string;
  format?: "text" | "markdown" | "json";
  ocrMode?: "auto" | "on" | "off";
  ocrLanguage?: string;
  targetPages?: string;
  maxPages?: number;
  dpi?: number;
  imageMode?: "off" | "placeholder" | "embed";
  extractLinks?: boolean;
  preserveVerySmallText?: boolean;
  emitWordBoxes?: boolean;
  skipDiagonalText?: boolean;
  includeComplexity?: boolean;
  cropBox?: { top: number; right: number; bottom: number; left: number };
  force?: boolean;
}

export type QueryDocumentOptions =
  | {
      action: "read";
      documentId: string;
      page?: number;
      startLine?: number;
      lineCount?: number;
    }
  | {
      action: "search";
      documentId: string;
      phrase: string;
      caseSensitive?: boolean;
      maxResults?: number;
      contextChars?: number;
    };

export interface ScreenshotDocumentOptions {
  documentId: string;
  pages: number[];
  dpi?: number;
  includeImages?: boolean;
}

export interface DiagramOptions {
  code: string;
  format: "ascii" | "svg" | "html";
  outputPath?: string;
}

export interface ToolResult<TDetails = Record<string, unknown>> {
  content: Array<
    { type: "text"; text: string } | { type: "image"; data: string; mimeType: string }
  >;
  details: TDetails;
}
