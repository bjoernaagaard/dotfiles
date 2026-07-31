import { readFile, realpath, stat } from "node:fs/promises";
import { resolve } from "node:path";
import type {
  CodemodCandidateResult,
  CodemodPreviewEntry,
  CodemodPreviewResult,
  CodemodSelector,
  SearchMatch,
} from "../domain.js";
import { isWithin } from "../ast-grep/path.js";

export interface CreateEphemeralPreviewOptions {
  readonly cwd: string;
  readonly selector: CodemodSelector;
  readonly candidates: CodemodCandidateResult;
  readonly page?: number;
  readonly pageSize?: number;
  readonly maxFiles: number;
  readonly maxChanges: number;
  readonly maxSourceBytes: number;
}

export class CodemodPreviewError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CodemodPreviewError";
  }
}

/**
 * Materialize exact read-only replacement text for one bounded page. Source is
 * read only long enough to extract pre-images; no snapshot or hash is retained.
 */
export async function createEphemeralPreview(options: CreateEphemeralPreviewOptions): Promise<CodemodPreviewResult> {
  const page = options.page ?? 1;
  const pageSize = options.pageSize ?? 20;
  assertPositiveInteger(page, "page");
  assertPositiveInteger(pageSize, "pageSize");
  assertPositiveInteger(options.maxFiles, "maxFiles");
  assertPositiveInteger(options.maxChanges, "maxChanges");
  assertPositiveInteger(options.maxSourceBytes, "maxSourceBytes");
  if (pageSize > 100) throw new CodemodPreviewError("pageSize cannot exceed 100");
  if (options.candidates.matches.length > options.maxChanges) {
    throw new CodemodPreviewError(
      `preview contains ${options.candidates.matches.length} changes, exceeding limit ${options.maxChanges}`,
    );
  }

  const root = await realpath(resolve(options.cwd));
  const grouped = new Map<string, SearchMatch[]>();
  for (const match of options.candidates.matches) {
    if (match.replacement === undefined || match.replacementOffsets === undefined) {
      throw new CodemodPreviewError(`match in ${match.file} lacks replacement text or offsets`);
    }
    const current = grouped.get(match.file) ?? [];
    current.push(match);
    grouped.set(match.file, current);
  }
  if (grouped.size > options.maxFiles) {
    throw new CodemodPreviewError(`preview affects ${grouped.size} files, exceeding limit ${options.maxFiles}`);
  }

  const entries: CodemodPreviewEntry[] = [];
  let sourceBytes = 0;
  for (const file of [...grouped.keys()].sort()) {
    const absolute = resolve(root, file);
    if (!isWithin(root, absolute)) throw new CodemodPreviewError(`preview path escapes project root: ${file}`);
    const canonical = await realpath(absolute);
    if (!isWithin(root, canonical)) throw new CodemodPreviewError(`preview symlink escapes project root: ${file}`);
    const info = await stat(canonical);
    if (!info.isFile()) throw new CodemodPreviewError(`preview target is not a regular file: ${file}`);
    const source = await readFile(canonical);
    sourceBytes += source.length;
    if (sourceBytes > options.maxSourceBytes) {
      throw new CodemodPreviewError(`preview source reads exceed limit ${options.maxSourceBytes} bytes`);
    }
    const decoded = source.toString("utf8");
    if (!Buffer.from(decoded, "utf8").equals(source)) throw new CodemodPreviewError(`preview target is not valid UTF-8: ${file}`);
    entries.push(...entriesForFile(file, source, grouped.get(file)!));
  }

  const withConflicts = assignConflictGroups(entries);
  const conflictGroupCount = new Set(withConflicts.flatMap((entry) => entry.conflictGroup === undefined ? [] : [entry.conflictGroup])).size;
  const totalPages = withConflicts.length === 0 ? 0 : Math.ceil(withConflicts.length / pageSize);
  if (totalPages > 0 && page > totalPages) throw new CodemodPreviewError(`page ${page} exceeds total pages ${totalPages}`);
  if (totalPages === 0 && page !== 1) throw new CodemodPreviewError("empty preview only has page 1");
  const start = (page - 1) * pageSize;

  return {
    queryKind: options.candidates.queryKind,
    selector: options.selector,
    preview: {
      page,
      pageSize,
      totalPages,
      totalChanges: withConflicts.length,
      fileCount: grouped.size,
      conflictGroupCount,
      skippedWithoutFix: options.candidates.skippedWithoutFix,
      items: withConflicts.slice(start, start + pageSize),
      truncatedByLimits: false,
    },
    diagnostics: options.candidates.diagnostics,
    operation: options.candidates.operation,
    advisoryOnly: true,
  };
}

function entriesForFile(file: string, source: Buffer, matches: readonly SearchMatch[]): CodemodPreviewEntry[] {
  const unique = new Map<string, CodemodPreviewEntry>();
  for (const match of matches) {
    const range = match.replacementOffsets!;
    if (range.start < 0 || range.end < range.start || range.end > source.length) {
      throw new CodemodPreviewError(`replacement range exceeds ${file}: ${range.start}-${range.end}`);
    }
    const beforeBytes = source.subarray(range.start, range.end);
    const before = beforeBytes.toString("utf8");
    if (!Buffer.from(before, "utf8").equals(beforeBytes)) {
      throw new CodemodPreviewError(`replacement splits a UTF-8 sequence in ${file}: ${range.start}-${range.end}`);
    }
    const key = `${file}\0${range.start}\0${range.end}\0${match.replacement}`;
    if (unique.has(key)) continue;
    unique.set(key, {
      file,
      sourceRange: match.range,
      replacementRange: range,
      before,
      replacement: match.replacement!,
      context: match.lines,
      ...(match.ruleId === undefined ? {} : { ruleId: match.ruleId }),
      ...(match.severity === undefined ? {} : { severity: match.severity }),
      ...(match.message === undefined ? {} : { message: match.message }),
    });
  }
  return [...unique.values()].sort((left, right) =>
    left.replacementRange.start - right.replacementRange.start
    || left.replacementRange.end - right.replacementRange.end
    || left.replacement.localeCompare(right.replacement));
}

function assignConflictGroups(entries: readonly CodemodPreviewEntry[]): CodemodPreviewEntry[] {
  const output = [...entries];
  const byFile = new Map<string, number[]>();
  for (let index = 0; index < output.length; index += 1) {
    const file = output[index]!.file;
    const current = byFile.get(file) ?? [];
    current.push(index);
    byFile.set(file, current);
  }

  let groupNumber = 0;
  for (const indexes of byFile.values()) {
    const visited = new Set<number>();
    for (const index of indexes) {
      if (visited.has(index)) continue;
      const group: number[] = [];
      const pending = [index];
      visited.add(index);
      while (pending.length > 0) {
        const current = pending.pop()!;
        group.push(current);
        for (const candidate of indexes) {
          if (visited.has(candidate)) continue;
          if (rangesConflict(output[current]!.replacementRange, output[candidate]!.replacementRange)) {
            visited.add(candidate);
            pending.push(candidate);
          }
        }
      }
      if (group.length < 2) continue;
      const id = `conflict-${String(++groupNumber).padStart(4, "0")}`;
      for (const member of group) output[member] = { ...output[member]!, conflictGroup: id };
    }
  }
  return output;
}

function rangesConflict(left: { start: number; end: number }, right: { start: number; end: number }): boolean {
  if (left.start === right.start && (left.start === left.end || right.start === right.end)) return true;
  return left.start < right.end && right.start < left.end;
}

function assertPositiveInteger(value: number, name: string): void {
  if (!Number.isInteger(value) || value < 1) throw new CodemodPreviewError(`${name} must be a positive integer`);
}
