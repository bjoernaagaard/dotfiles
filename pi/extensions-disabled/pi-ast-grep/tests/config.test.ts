import assert from "node:assert/strict";
import { mkdir, mkdtemp, realpath, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { ConfigError, discoverSgConfigUpward, loadConfig } from "../src/config.js";

async function fixture(): Promise<{ root: string; agent: string; cwd: string }> {
  const root = await mkdtemp(join(tmpdir(), "pi-ast-grep-config-test-"));
  const agent = join(root, "agent");
  const cwd = join(root, "project");
  await mkdir(join(cwd, ".pi"), { recursive: true });
  await mkdir(agent, { recursive: true });
  return { root, agent, cwd };
}

test("file configuration has deterministic PATH executable and project limits only tighten", async (t) => {
  const f = await fixture();
  t.after(() => rm(f.root, { recursive: true, force: true }));
  await writeFile(join(f.agent, "ast-grep.json"), JSON.stringify({
    timeoutMs: 40_000,
    limits: { maxResults: 2_000, maxProcessOutputBytes: 8 * 1024 * 1024 },
    statusStyle: "ascii",
  }));
  await writeFile(join(f.cwd, ".pi", "ast-grep.json"), JSON.stringify({
    timeoutMs: 10_000,
    limits: { maxResults: 100, maxProcessOutputBytes: 1024 * 1024 },
    discoverSgConfig: false,
    profile: true,
  }));
  const config = await loadConfig({ agentDir: f.agent, cwd: f.cwd, configDirName: ".pi" });
  assert.equal(config.executable, "ast-grep");
  assert.equal(config.limits.timeoutMs, 10_000);
  assert.equal(config.limits.maxResults, 100);
  assert.equal(config.profile, true);
  assert.equal(config.statusStyle, "ascii");
  assert.equal(config.projectConfigLoaded, true);
});

test("project config is not trust-gated and cannot raise limits or set executable/argv", async (t) => {
  const f = await fixture();
  t.after(() => rm(f.root, { recursive: true, force: true }));
  await writeFile(join(f.agent, "ast-grep.json"), JSON.stringify({ limits: { maxResults: 10 } }));
  await writeFile(join(f.cwd, ".pi", "ast-grep.json"), JSON.stringify({ limits: { maxResults: 11 } }));
  await assert.rejects(loadConfig({ agentDir: f.agent, cwd: f.cwd, configDirName: ".pi" }), /cannot exceed global limit/u);
  for (const value of [{ executable: "/tmp/sg" }, { extraArgs: ["-U"] }]) {
    await writeFile(join(f.cwd, ".pi", "ast-grep.json"), JSON.stringify(value));
    await assert.rejects(loadConfig({ agentDir: f.agent, cwd: f.cwd, configDirName: ".pi" }), /unknown project setting/u);
  }
});

test("project sgConfig remains confined including symlinks", async (t) => {
  const f = await fixture();
  t.after(() => rm(f.root, { recursive: true, force: true }));
  const inside = join(f.cwd, "sgconfig.yml");
  await writeFile(inside, "ruleDirs: []\n");
  await writeFile(join(f.cwd, ".pi", "ast-grep.json"), JSON.stringify({ sgConfig: "sgconfig.yml" }));
  assert.equal((await loadConfig({ agentDir: f.agent, cwd: f.cwd, configDirName: ".pi" })).sgConfigPath, await realpath(inside));

  const outside = join(f.root, "outside.yml");
  await writeFile(outside, "ruleDirs: []\n");
  await symlink(outside, join(f.cwd, "linked.yml"));
  await writeFile(join(f.cwd, ".pi", "ast-grep.json"), JSON.stringify({ sgConfig: "linked.yml" }));
  await assert.rejects(loadConfig({ agentDir: f.agent, cwd: f.cwd, configDirName: ".pi" }), /including symlinks/u);
});

test("sgconfig discovery walks upward, prefers yml, and validates settings", async (t) => {
  const f = await fixture();
  t.after(() => rm(f.root, { recursive: true, force: true }));
  const nested = join(f.cwd, "a", "b");
  await mkdir(nested, { recursive: true });
  await writeFile(join(f.cwd, "sgconfig.yaml"), "ruleDirs: []\n");
  await writeFile(join(f.cwd, "sgconfig.yml"), "ruleDirs: []\n");
  assert.equal(await discoverSgConfigUpward(nested), await realpath(join(f.cwd, "sgconfig.yml")));

  await writeFile(join(f.cwd, ".pi", "ast-grep.json"), JSON.stringify({ statusStyle: "bad" }));
  await assert.rejects(loadConfig({ agentDir: f.agent, cwd: f.cwd, configDirName: ".pi" }), ConfigError);
});
