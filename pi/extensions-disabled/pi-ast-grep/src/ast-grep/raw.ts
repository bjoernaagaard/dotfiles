import type {
  MetavariableCapture,
  Metavariables,
  OutlineFile,
  OutlineItem,
  ScanLabel,
  SearchMatch,
  SourcePosition,
  SourceRange,
} from "../domain.js";
import { normalizeProjectPath } from "./path.js";

/** Raw CLI validation stays confined to this adapter module. */
export function normalizeOutlineRecord(value: Record<string, unknown>, cwd: string): OutlineFile {
  return {
    path: normalizeProjectPath(cwd, stringAt(value, "path", "$")),
    language: stringAt(value, "language", "$"),
    items: arrayAt(value, "items", "$").map((item, index) =>
      normalizeOutlineItem(record(item, `$.items[${index}]`), `$.items[${index}]`),
    ),
  };
}

export function normalizeSearchRecord(value: Record<string, unknown>, cwd: string): SearchMatch {
  const charCount = recordAt(value, "charCount", "$");
  const metaVariables = recordAt(value, "metaVariables", "$");
  const labels = value.labels === undefined
    ? undefined
    : array(value.labels, "$.labels").map((label, index) => normalizeLabel(record(label, `$.labels[${index}]`), `$.labels[${index}]`));
  const replacementOffsets = value.replacementOffsets === undefined
    ? undefined
    : byteRange(record(value.replacementOffsets, "$.replacementOffsets"), "$.replacementOffsets");
  return {
    text: stringAt(value, "text", "$"),
    range: sourceRange(recordAt(value, "range", "$"), "$.range"),
    file: normalizeProjectPath(cwd, stringAt(value, "file", "$")),
    lines: stringAt(value, "lines", "$"),
    charCount: {
      leading: nonNegativeIntegerAt(charCount, "leading", "$.charCount"),
      trailing: nonNegativeIntegerAt(charCount, "trailing", "$.charCount"),
    },
    language: stringAt(value, "language", "$"),
    metaVariables: normalizeMetaVariables(metaVariables, "$.metaVariables"),
    ...optionalStringProperty(value, "ruleId", "$"),
    ...optionalStringProperty(value, "severity", "$"),
    ...optionalStringProperty(value, "message", "$"),
    ...optionalStringProperty(value, "note", "$"),
    ...(labels === undefined ? {} : { labels }),
    ...optionalStringProperty(value, "replacement", "$"),
    ...(replacementOffsets === undefined ? {} : { replacementOffsets }),
  };
}

function normalizeLabel(value: Record<string, unknown>, path: string): ScanLabel {
  return {
    text: stringAt(value, "text", path),
    range: sourceRange(recordAt(value, "range", path), `${path}.range`),
    ...optionalStringProperty(value, "message", path),
    ...optionalStringProperty(value, "style", path),
  };
}

function normalizeOutlineItem(value: Record<string, unknown>, path: string): OutlineItem {
  const role = stringAt(value, "role", path);
  if (role !== "item" && role !== "member") fail(`${path}.role`, "expected item or member");
  const membersValue = value.members;
  const members = membersValue === undefined
    ? []
    : array(membersValue, `${path}.members`).map((member, index) =>
        normalizeOutlineItem(record(member, `${path}.members[${index}]`), `${path}.members[${index}]`),
      );

  const isImport = optionalBooleanAt(value, "isImport", path);
  const isExported = optionalBooleanAt(value, "isExported", path);
  const isPublic = optionalBooleanAt(value, "isPublic", path);
  return {
    role,
    symbolType: stringAt(value, "symbolType", path),
    name: stringAt(value, "name", path),
    range: sourceRange(recordAt(value, "range", path), `${path}.range`),
    signature: stringAt(value, "signature", path),
    astKind: stringAt(value, "astKind", path),
    ...(isImport === undefined ? {} : { isImport }),
    ...(isExported === undefined ? {} : { isExported }),
    ...(isPublic === undefined ? {} : { isPublic }),
    members,
  };
}

function normalizeMetaVariables(value: Record<string, unknown>, path: string): Metavariables {
  const singleRaw = recordAt(value, "single", path);
  const multiRaw = recordAt(value, "multi", path);
  const transformedRaw = recordAt(value, "transformed", path);

  const single: Record<string, MetavariableCapture> = {};
  for (const [name, capture] of Object.entries(singleRaw)) {
    single[name] = normalizeCapture(name, capture, `${path}.single.${name}`);
  }

  const multi: Record<string, readonly MetavariableCapture[]> = {};
  for (const [name, captures] of Object.entries(multiRaw)) {
    multi[name] = array(captures, `${path}.multi.${name}`).map((capture, index) =>
      normalizeCapture(name, capture, `${path}.multi.${name}[${index}]`),
    );
  }

  const transformed: Record<string, MetavariableCapture> = {};
  for (const [name, capture] of Object.entries(transformedRaw)) {
    transformed[name] = normalizeCapture(name, capture, `${path}.transformed.${name}`);
  }
  return { single, multi, transformed };
}

function normalizeCapture(name: string, value: unknown, path: string): MetavariableCapture {
  if (typeof value === "string") return { name, text: value };
  const capture = record(value, path);
  const rangeValue = capture.range;
  return {
    name,
    text: stringAt(capture, "text", path),
    ...(rangeValue === undefined ? {} : { range: sourceRange(record(rangeValue, `${path}.range`), `${path}.range`) }),
  };
}

export function sourceRange(value: Record<string, unknown>, path = "$range"): SourceRange {
  const bytes = recordAt(value, "byteOffset", path);
  const start = position(recordAt(value, "start", path), `${path}.start`);
  const end = position(recordAt(value, "end", path), `${path}.end`);
  const byteStart = nonNegativeIntegerAt(bytes, "start", `${path}.byteOffset`);
  const byteEnd = nonNegativeIntegerAt(bytes, "end", `${path}.byteOffset`);
  if (byteEnd < byteStart) fail(`${path}.byteOffset`, "end precedes start");
  if (comparePosition(end, start) < 0) fail(path, "end position precedes start");
  return { bytes: { start: byteStart, end: byteEnd }, start, end };
}

function byteRange(value: Record<string, unknown>, path: string): { start: number; end: number } {
  const start = nonNegativeIntegerAt(value, "start", path);
  const end = nonNegativeIntegerAt(value, "end", path);
  if (end < start) fail(path, "end precedes start");
  return { start, end };
}

function position(value: Record<string, unknown>, path: string): SourcePosition {
  return {
    line: nonNegativeIntegerAt(value, "line", path),
    column: nonNegativeIntegerAt(value, "column", path),
  };
}

function comparePosition(left: SourcePosition, right: SourcePosition): number {
  return left.line === right.line ? left.column - right.column : left.line - right.line;
}

function recordAt(value: Record<string, unknown>, key: string, path: string): Record<string, unknown> {
  return record(value[key], `${path}.${key}`);
}

function record(value: unknown, path: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) fail(path, "expected object");
  return value as Record<string, unknown>;
}

function arrayAt(value: Record<string, unknown>, key: string, path: string): readonly unknown[] {
  return array(value[key], `${path}.${key}`);
}

function array(value: unknown, path: string): readonly unknown[] {
  if (!Array.isArray(value)) fail(path, "expected array");
  return value;
}

function stringAt(value: Record<string, unknown>, key: string, path: string): string {
  const candidate = value[key];
  if (typeof candidate !== "string") fail(`${path}.${key}`, "expected string");
  return candidate;
}

function nonNegativeIntegerAt(value: Record<string, unknown>, key: string, path: string): number {
  const candidate = value[key];
  if (!Number.isInteger(candidate) || (candidate as number) < 0) {
    fail(`${path}.${key}`, "expected non-negative integer");
  }
  return candidate as number;
}

function optionalStringProperty<K extends string>(
  value: Record<string, unknown>,
  key: K,
  path: string,
): Partial<Record<K, string>> {
  const candidate = value[key];
  // ast-grep scan JSON often emits optional string metadata as null.
  if (candidate === undefined || candidate === null) return {};
  if (typeof candidate !== "string") fail(`${path}.${key}`, "expected string");
  return { [key]: candidate } as Record<K, string>;
}

function optionalBooleanAt(value: Record<string, unknown>, key: string, path: string): boolean | undefined {
  const candidate = value[key];
  if (candidate === undefined) return undefined;
  if (typeof candidate !== "boolean") fail(`${path}.${key}`, "expected boolean");
  return candidate;
}

function fail(path: string, message: string): never {
  throw new Error(`Invalid ast-grep JSON at ${path}: ${message}`);
}
