/**
 * Secret-safe header resolution.
 * Resolved values stay in process memory only — never log or put into tool content/details.
 */
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export type HeadersResolver = {
  type: "env" | "command";
  value: string;
};

export type HeaderResolveOptions = {
  signal?: AbortSignal;
  /** Command resolver timeout in ms (default 5000). */
  timeoutMs?: number;
};

/**
 * Resolve profile headers into a plain header map.
 * - static headers (non-secret preferred) applied first
 * - headersResolver wins on key clash
 *
 * Resolver return conventions:
 * - env: value of process.env[VAR]; if it looks like "Header: value" multi-line map, parse it;
 *   if bare token (no colon lines), set Authorization: Bearer <token>
 * - command: stdout trimmed, same interpretation as env value
 */
export async function resolveHeaders(input: {
  staticHeaders?: Record<string, string>;
  resolver?: HeadersResolver;
  signal?: AbortSignal;
  timeoutMs?: number;
}): Promise<Record<string, string>> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...(input.staticHeaders ?? {}),
  };

  if (!input.resolver) return headers;

  const raw = await resolveResolverValue(input.resolver, {
    signal: input.signal,
    timeoutMs: input.timeoutMs,
  });

  if (raw === undefined || raw === "") return headers;

  const parsed = interpretResolverOutput(raw);
  for (const [k, v] of Object.entries(parsed)) {
    headers[k] = v;
  }
  return headers;
}

async function resolveResolverValue(
  resolver: HeadersResolver,
  opts: HeaderResolveOptions,
): Promise<string | undefined> {
  if (opts.signal?.aborted) {
    throw new Error("Aborted while resolving headers");
  }

  if (resolver.type === "env") {
    return process.env[resolver.value];
  }

  // command: run shell command, take stdout trim (timeout ~5s)
  const timeoutMs = opts.timeoutMs ?? 5000;
  try {
    // Use shell so users can write pipeline-style resolvers; values never logged.
    const { stdout } = await execFileAsync("sh", ["-c", resolver.value], {
      timeout: timeoutMs,
      signal: opts.signal,
      maxBuffer: 64 * 1024,
      encoding: "utf8",
    });
    return String(stdout).trim();
  } catch (err) {
    if (opts.signal?.aborted) throw new Error("Aborted while resolving headers");
    const msg = err instanceof Error ? err.message : String(err);
    // Do not include command output (may contain secrets).
    throw new Error(`headersResolver command failed: ${msg.split("\n")[0]}`);
  }
}

/**
 * Interpret resolver stdout / env value as either:
 * - multi-line "Header-Name: value" pairs
 * - single JSON object of headers
 * - bare token → Authorization: Bearer <token>
 */
export function interpretResolverOutput(raw: string): Record<string, string> {
  const trimmed = raw.trim();
  if (!trimmed) return {};

  // JSON object of headers
  if (trimmed.startsWith("{")) {
    try {
      const obj = JSON.parse(trimmed) as unknown;
      if (obj && typeof obj === "object" && !Array.isArray(obj)) {
        const out: Record<string, string> = {};
        for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
          if (typeof v === "string") out[k] = v;
        }
        return out;
      }
    } catch {
      // fall through
    }
  }

  // Multi-line Header: value
  const lines = trimmed.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  if (lines.length > 0 && lines.every((l) => /^[A-Za-z0-9-]+:\s*.+/.test(l))) {
    const out: Record<string, string> = {};
    for (const line of lines) {
      const idx = line.indexOf(":");
      const key = line.slice(0, idx).trim();
      const value = line.slice(idx + 1).trim();
      out[key] = value;
    }
    return out;
  }

  // Bare token
  return { Authorization: `Bearer ${trimmed}` };
}
