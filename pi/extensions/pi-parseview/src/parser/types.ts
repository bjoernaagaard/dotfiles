export interface ParseResult {
  text: string;
  pages: number;
}

export interface ParserToolParams {
  path: string;
  pages?: string;
  useOcr?: boolean;
}
