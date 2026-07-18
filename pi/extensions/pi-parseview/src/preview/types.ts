export interface PreviewResult {
  html: string;
}

export interface ExportOptions {
  html: string;
  outputPath: string;
  format: "png" | "pdf" | "html";
}

export interface PreviewToolParams {
  content?: string;
  filePath?: string;
  format: "terminal" | "browser" | "pdf";
  outputPath?: string;
  fontSizePx?: number;
}
