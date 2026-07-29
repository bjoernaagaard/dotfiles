import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { CONFIG_DIR_NAME } from "@earendil-works/pi-coding-agent";
import type { ProfilePolicy } from "../policy/types.ts";

/**
 * Connection profile (proposal §2.1).
 * headersResolver is stored on disk but never resolved into LLM context.
 */
export type Profile = {
  name: string;
  projectRoot?: string;
  dgCommand?: string | string[];
  graphqlHttp?: string;
  graphqlWs?: string;
  pathPrefix?: string;
  browserUrl?: string;
  defaultLocation?: string;
  defaultRepository?: string;
  policy?: ProfilePolicy;
  subscription?: "ws" | "poll";
  /** Static non-secret headers only if needed; prefer headersResolver for secrets. */
  headers?: Record<string, string>;
  headersResolver?: { type: "env" | "command"; value: string };
  redaction?: { extraKeyPatterns?: string[] };
};

/**
 * On-disk format for profiles.json:
 *   { "profiles": Profile[], "active": string | null }
 */
export type ProfilesFile = {
  profiles: Profile[];
  active: string | null;
};

export function getProfilePath(cwd: string): string {
  // Never hardcode ".pi" — rebranded distributions may change CONFIG_DIR_NAME.
  return join(cwd, CONFIG_DIR_NAME, "dagster", "profiles.json");
}

export function emptyProfilesFile(): ProfilesFile {
  return { profiles: [], active: null };
}

/**
 * Fail-closed for untrusted projects: do not read project-local profile files
 * (they may contain headersResolver secrets / command resolvers).
 */
export async function listProfiles(
  cwd: string,
  trusted: boolean,
): Promise<ProfilesFile> {
  if (!trusted) {
    // Untrusted → no project profile file reads.
    return emptyProfilesFile();
  }
  return readProfilesFile(getProfilePath(cwd));
}

export async function readProfilesFile(path: string): Promise<ProfilesFile> {
  try {
    const raw = await readFile(path, "utf8");
    return parseProfilesFile(raw);
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === "ENOENT") return emptyProfilesFile();
    throw err;
  }
}

export function parseProfilesFile(raw: string): ProfilesFile {
  const data = JSON.parse(raw) as unknown;
  if (!data || typeof data !== "object") {
    throw new Error("profiles.json must be an object");
  }
  const obj = data as Record<string, unknown>;
  const profiles = Array.isArray(obj.profiles) ? (obj.profiles as Profile[]) : [];
  const active =
    typeof obj.active === "string" || obj.active === null ? (obj.active as string | null) : null;
  // Strip nothing yet; callers must not surface headersResolver values to the LLM.
  return {
    profiles: profiles.map(normalizeProfile),
    active,
  };
}

function normalizeProfile(p: Profile): Profile {
  if (!p || typeof p.name !== "string" || !p.name.trim()) {
    throw new Error("Each profile must have a non-empty name");
  }
  return { ...p, name: p.name.trim() };
}

/** Public (non-secret) fields safe for status / LLM context. */
export function publicProfileView(
  profile: Profile,
): Omit<Profile, "headersResolver" | "headers"> {
  const { headersResolver: _secret, headers: _staticMaybeSecret, ...rest } = profile;
  return rest;
}

export async function writeProfilesFile(path: string, file: ProfilesFile): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const payload: ProfilesFile = {
    profiles: file.profiles.map(normalizeProfile),
    active: file.active,
  };
  await writeFile(path, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
}

export async function saveProfiles(
  cwd: string,
  trusted: boolean,
  file: ProfilesFile,
): Promise<void> {
  if (!trusted) {
    throw new Error("Refusing to write project-local Dagster profiles: project is not trusted");
  }
  await writeProfilesFile(getProfilePath(cwd), file);
}
