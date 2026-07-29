/**
 * Redact secrets from structured objects and YAML-ish strings before tool emission.
 */

const DEFAULT_KEY_PATTERNS = [
  "password",
  "secret",
  "token",
  "api_key",
  "apikey",
  "authorization",
  "credentials",
  "private_key",
  "access_key",
];

const REDACTED = "[REDACTED]";

function compilePatterns(extra?: string[]): RegExp[] {
  const keys = [...DEFAULT_KEY_PATTERNS, ...(extra ?? [])];
  return keys.map((k) => new RegExp(k.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i"));
}

function keyMatches(key: string, patterns: RegExp[]): boolean {
  return patterns.some((re) => re.test(key));
}

/**
 * Deep-clone-ish redaction: objects/arrays copied with secret keys replaced.
 * Does not mutate the input.
 */
export function redactObject(value: unknown, extraKeyPatterns?: string[]): unknown {
  const patterns = compilePatterns(extraKeyPatterns);
  return redactWalk(value, patterns, new WeakSet(), extraKeyPatterns);
}

function redactWalk(
  value: unknown,
  patterns: RegExp[],
  seen: WeakSet<object>,
  extraKeyPatterns?: string[],
): unknown {
  if (value === null || value === undefined) return value;
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return value;
  }
  if (typeof value !== "object") return value;

  if (seen.has(value as object)) return "[Circular]";
  seen.add(value as object);

  if (Array.isArray(value)) {
    return value.map((v) => redactWalk(v, patterns, seen, extraKeyPatterns));
  }

  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    if (keyMatches(k, patterns)) {
      out[k] = REDACTED;
    } else if (typeof v === "string") {
      // Nested YAML/env-like blobs must honor profile extraKeyPatterns too.
      out[k] = looksLikeConfigBlob(v)
        ? redactYamlish(v, patternsToExtra(patterns, extraKeyPatterns))
        : v;
    } else {
      out[k] = redactWalk(v, patterns, seen, extraKeyPatterns);
    }
  }
  return out;
}

/**
 * Carry caller-supplied extra patterns into nested yamlish redaction.
 * Defaults are recompiled inside redactYamlish; only non-default extras must be forwarded.
 */
function patternsToExtra(
  _patterns: RegExp[],
  extraKeyPatterns?: string[],
): string[] {
  void _patterns;
  return extraKeyPatterns ?? [];
}

function looksLikeConfigBlob(s: string): boolean {
  return s.length > 40 && (s.includes(":\n") || s.includes(": ") || s.includes("\n"));
}

/**
 * Redact YAML-ish / env-style key: value lines.
 * Matches keys case-insensitively against default + extra patterns.
 */
export function redactYamlish(text: string, extraKeyPatterns?: string[]): string {
  if (!text) return text;
  const patterns = compilePatterns(extraKeyPatterns);
  return text
    .split(/\r?\n/)
    .map((line) => redactYamlLine(line, patterns))
    .join("\n");
}

function redactYamlLine(line: string, patterns: RegExp[]): string {
  // key: value  |  - key: value  |  KEY=value
  const yamlMatch = line.match(/^(\s*-?\s*)([A-Za-z0-9_.\/-]+)(\s*:\s*)(.*)$/);
  if (yamlMatch) {
    const [, prefix, key, sep, rest] = yamlMatch;
    if (keyMatches(key!, patterns)) {
      // Preserve quotes style lightly
      const trimmed = rest!.trim();
      if (
        (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
        (trimmed.startsWith("'") && trimmed.endsWith("'"))
      ) {
        return `${prefix}${key}${sep}"${REDACTED}"`;
      }
      return `${prefix}${key}${sep}${REDACTED}`;
    }
    return line;
  }

  const envMatch = line.match(/^(\s*)([A-Za-z0-9_]+)(\s*=\s*)(.*)$/);
  if (envMatch) {
    const [, prefix, key, sep] = envMatch;
    if (keyMatches(key!, patterns)) {
      return `${prefix}${key}${sep}${REDACTED}`;
    }
  }

  return line;
}

export const DEFAULT_REDACTION_KEY_PATTERNS = [...DEFAULT_KEY_PATTERNS];
