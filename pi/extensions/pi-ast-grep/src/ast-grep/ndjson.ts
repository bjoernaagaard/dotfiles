export class NdjsonParseError extends Error {
  readonly line: number;

  constructor(line: number, message: string) {
    super(`Invalid NDJSON at line ${line}: ${message}`);
    this.name = "NdjsonParseError";
    this.line = line;
  }
}

export interface ParseNdjsonOptions {
  readonly maxRecords?: number;
}

/** Parse a complete NDJSON stream, tolerating blank lines and a leading BOM. */
export function parseNdjson(
  input: string,
  options: ParseNdjsonOptions = {},
): readonly Record<string, unknown>[] {
  const maxRecords = options.maxRecords ?? Number.POSITIVE_INFINITY;
  if (!Number.isInteger(maxRecords) && maxRecords !== Number.POSITIVE_INFINITY) {
    throw new RangeError("maxRecords must be an integer");
  }
  if (maxRecords < 0) throw new RangeError("maxRecords must be non-negative");

  const records: Record<string, unknown>[] = [];
  const lines = input.split(/\r?\n/u);
  for (let index = 0; index < lines.length; index += 1) {
    let line = lines[index] ?? "";
    if (index === 0) line = line.replace(/^\uFEFF/u, "");
    if (line.trim() === "") continue;
    if (records.length >= maxRecords) {
      throw new NdjsonParseError(index + 1, `record limit ${maxRecords} exceeded`);
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(line);
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      throw new NdjsonParseError(index + 1, reason);
    }
    if (!isRecord(parsed)) {
      throw new NdjsonParseError(index + 1, "expected a JSON object");
    }
    records.push(parsed);
  }
  return records;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
