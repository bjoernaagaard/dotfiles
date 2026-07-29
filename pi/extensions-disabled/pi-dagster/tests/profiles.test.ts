import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { CONFIG_DIR_NAME } from "@earendil-works/pi-coding-agent";
import {
  emptyProfilesFile,
  getProfilePath,
  listProfiles,
  parseProfilesFile,
  publicProfileView,
  readProfilesFile,
  saveProfiles,
  writeProfilesFile,
  type Profile,
  type ProfilesFile,
} from "../src/state/profiles.ts";

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((d) => rm(d, { recursive: true, force: true })));
});

async function tempCwd(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "pi-dagster-profiles-"));
  tempDirs.push(dir);
  return dir;
}

describe("profile path", () => {
  it("uses CONFIG_DIR_NAME and never hardcodes a different segment", () => {
    const path = getProfilePath("/proj");
    expect(path).toBe(join("/proj", CONFIG_DIR_NAME, "dagster", "profiles.json"));
    expect(path.includes(CONFIG_DIR_NAME)).toBe(true);
    // Path structure is cwd / CONFIG_DIR_NAME / dagster / profiles.json
    expect(path.endsWith(join(CONFIG_DIR_NAME, "dagster", "profiles.json"))).toBe(true);
  });
});

describe("profiles round-trip", () => {
  it("read/write profiles in a temp dir", async () => {
    const cwd = await tempCwd();
    const path = getProfilePath(cwd);
    const file: ProfilesFile = {
      active: "local-dev",
      profiles: [
        {
          name: "local-dev",
          graphqlHttp: "http://localhost:3000/graphql",
          policy: "confirmMutations",
          headersResolver: { type: "env", value: "DAGSTER_TOKEN" },
        },
        {
          name: "staging",
          graphqlHttp: "https://staging.example/graphql",
          policy: "readOnly",
        },
      ],
    };

    await writeProfilesFile(path, file);
    const raw = await readFile(path, "utf8");
    expect(raw).toContain("local-dev");

    const loaded = await readProfilesFile(path);
    expect(loaded.active).toBe("local-dev");
    expect(loaded.profiles).toHaveLength(2);
    expect(loaded.profiles[0]?.headersResolver).toEqual({
      type: "env",
      value: "DAGSTER_TOKEN",
    });

    // saveProfiles respects trust
    await saveProfiles(cwd, true, {
      ...loaded,
      active: "staging",
    });
    const again = await readProfilesFile(path);
    expect(again.active).toBe("staging");
  });

  it("parseProfilesFile validates shape", () => {
    const parsed = parseProfilesFile(
      JSON.stringify({
        profiles: [{ name: "a" }],
        active: null,
      }),
    );
    expect(parsed).toEqual({ profiles: [{ name: "a" }], active: null });
    expect(emptyProfilesFile()).toEqual({ profiles: [], active: null });
  });
});

describe("trust gate", () => {
  it("untrusted path does not read project profile file", async () => {
    const cwd = await tempCwd();
    const path = getProfilePath(cwd);
    const secretProfile: Profile = {
      name: "secret-target",
      headersResolver: { type: "command", value: "op read secret" },
      graphqlHttp: "https://hidden.example/graphql",
    };
    await writeProfilesFile(path, {
      active: "secret-target",
      profiles: [secretProfile],
    });

    // Trusted can read
    const trusted = await listProfiles(cwd, true);
    expect(trusted.profiles).toHaveLength(1);
    expect(trusted.profiles[0]?.name).toBe("secret-target");

    // Untrusted: fail-closed, no file read
    const untrusted = await listProfiles(cwd, false);
    expect(untrusted).toEqual(emptyProfilesFile());
    expect(untrusted.profiles).toHaveLength(0);
  });

  it("publicProfileView strips headersResolver", () => {
    const profile: Profile = {
      name: "x",
      graphqlHttp: "http://localhost/graphql",
      headersResolver: { type: "env", value: "SECRET" },
    };
    const pub = publicProfileView(profile);
    expect(pub).toEqual({ name: "x", graphqlHttp: "http://localhost/graphql" });
    expect("headersResolver" in pub).toBe(false);
  });

  it("refuses write when untrusted", async () => {
    const cwd = await tempCwd();
    await expect(
      saveProfiles(cwd, false, {
        active: null,
        profiles: [{ name: "nope" }],
      }),
    ).rejects.toThrow(/not trusted/);
  });
});
