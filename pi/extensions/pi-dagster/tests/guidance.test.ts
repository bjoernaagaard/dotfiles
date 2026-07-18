import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { DAGSTER_CORE_GUIDANCE, DAGSTER_LOADER_GUIDELINES } from "../src/guidance.ts";
import { getToolMeta } from "../src/tools/catalog.ts";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (path: string) => readFileSync(join(root, path), "utf8");

describe("tool-native Dagster guidance", () => {
  it("does not declare bundled skills and keeps the explicit diagnose prompt", () => {
    const manifest = JSON.parse(read("package.json")) as { pi?: Record<string, unknown> };
    expect(manifest.pi?.skills).toBeUndefined();
    expect(read("prompts/diagnose-run.md")).toContain("dagster_evidence_pack");
    expect(read("prompts/diagnose-run.md")).toContain("dagster_compare_run");
  });

  it("keeps critical workflow rules in core and loader guidance", () => {
    expect(DAGSTER_CORE_GUIDANCE).toMatch(/search_tools/);
    expect(DAGSTER_CORE_GUIDANCE).toMatch(/typed tools/);
    expect(DAGSTER_CORE_GUIDANCE).toMatch(/force=true/);
    expect(DAGSTER_CORE_GUIDANCE).toMatch(/evidence_pack/);
    expect(DAGSTER_CORE_GUIDANCE).toMatch(/strictly comparable/);
    expect(DAGSTER_CORE_GUIDANCE).toMatch(/dg check/);
    expect(DAGSTER_CORE_GUIDANCE).toMatch(/cache-only/);
    expect(DAGSTER_LOADER_GUIDELINES.join(" ")).toMatch(/additively|capability is missing/);
    expect(read("extensions/core.ts")).toContain("DAGSTER_CORE_GUIDANCE");
  });

  it("makes the loader catalog expose safe operation and diagnosis routes", () => {
    expect(getToolMeta("dagster_launch_run")?.description).toMatch(/policy-gated|inspect/i);
    expect(getToolMeta("dagster_watch_run")?.description).toMatch(/log path|full streams/i);
    expect(getToolMeta("dagster_evidence_pack")?.description).toMatch(/bounded redacted/i);
    expect(getToolMeta("dagster_compare_run")?.description).toMatch(/strictly comparable|not success/i);
    expect(getToolMeta("dagster_dg_command")?.description).toMatch(/dg check|dagster-dev/i);
  });

  it("keeps command help on the same workflow", () => {
    const ui = read("src/modules/ui.ts");
    expect(ui).toContain("evidence → strict baseline comparison → dg check");
    expect(ui).toContain("not dagster_dg_command");
    expect(ui).toContain("log paths, not full streams");
  });
});
