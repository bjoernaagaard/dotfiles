import { createHash } from "node:crypto";
import { Buffer } from "node:buffer";

export function sha256Hex(input: Buffer | Uint8Array | string): string {
  return createHash("sha256").update(input).digest("hex");
}

export function sha256Prefix(input: Buffer | Uint8Array | string, length = 24): string {
  return sha256Hex(input).slice(0, length);
}

export function stableStringify(value: unknown): string {
  return JSON.stringify(sortValue(value));
}

function sortValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortValue);
  if (!value || typeof value !== "object") return value;
  const out: Record<string, unknown> = {};
  for (const key of Object.keys(value as Record<string, unknown>).sort()) {
    out[key] = sortValue((value as Record<string, unknown>)[key]);
  }
  return out;
}

export function isFinitePositiveInteger(value: unknown): value is number {
  return (
    typeof value === "number" && Number.isInteger(value) && Number.isFinite(value) && value > 0
  );
}

export function isFiniteNonNegativeInteger(value: unknown): value is number {
  return (
    typeof value === "number" && Number.isInteger(value) && Number.isFinite(value) && value >= 0
  );
}

export function isFinitePositiveNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}

export function utf8ByteLength(text: string): number {
  return Buffer.byteLength(text, "utf8");
}

export function truncateUtf8(text: string, maxBytes: number): { text: string; truncated: boolean } {
  const bytes = Buffer.from(text, "utf8");
  if (bytes.length <= maxBytes) return { text, truncated: false };
  let cut = Math.max(0, maxBytes);
  while (cut > 0 && (bytes[cut] & 0b1100_0000) === 0b1000_0000) cut -= 1;
  if (cut <= 0) return { text: "", truncated: true };
  const head = bytes.subarray(0, cut).toString("utf8");
  return { text: head, truncated: true };
}

export function truncateUtf8WithEllipsis(
  text: string,
  maxBytes: number,
): { text: string; truncated: boolean } {
  const base = truncateUtf8(text, maxBytes);
  if (!base.truncated) return base;
  const ellipsis = "…";
  const room = maxBytes - utf8ByteLength(ellipsis);
  if (room <= 0) return { text: "", truncated: true };
  const head = truncateUtf8(text, room).text;
  return { text: head + ellipsis, truncated: true };
}

export function trimPathForDisplay(path: string, maxBytes = 120): string {
  return truncateUtf8WithEllipsis(path, maxBytes).text;
}

export function ensureArray<T>(value: T | T[] | undefined): T[] {
  if (value === undefined) return [];
  return Array.isArray(value) ? value : [value];
}

export function toNonEmptyString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value : undefined;
}

export function parseJsonObject(text: string): Record<string, string> {
  const parsed = JSON.parse(text);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("OCR headers env must contain a JSON object");
  }
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
    if (typeof value !== "string") throw new Error("OCR headers env values must be strings");
    out[key] = value;
  }
  return out;
}

export function compactObject(value: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value)) {
    if (v !== undefined) out[k] = v;
  }
  return out;
}

export function normalizeRelativePath(root: string, input: string): string {
  return input.startsWith("/") ? input : `${root.replace(/\/$/, "")}/${input}`;
}

export function requireStrictObject(
  value: unknown,
  name = "value",
): asserts value is Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error(`${name} must be an object`);
}

export function abortError(message = "Aborted"): Error {
  const error = new Error(message);
  error.name = "AbortError";
  return error;
}

export function clampInteger(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}
