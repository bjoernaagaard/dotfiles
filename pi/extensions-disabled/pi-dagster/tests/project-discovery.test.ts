import { describe, expect, it } from "vitest";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { mkdtemp } from "node:fs/promises";
import {
  discoverProject,
  dgTomlLooksLikeWorkspace,
  pyprojectHasToolDg,
  resolveProjectRoot,
} from "../src/domain/project.ts";
import {
  defsDir,
  resolveDefsPath,
  resolveUnderProject,
} from "../src/domain/source-paths.ts";

describe("project discovery helpers", () => {
  it("detects [tool.dg] and workspace toml", () => {
    expect(pyprojectHasToolDg('[tool.dg]\ndirectory_type = "project"\n')).toBe(
      true,
    );
    expect(pyprojectHasToolDg("[tool.poetry]\nname='x'\n")).toBe(false);
    expect(dgTomlLooksLikeWorkspace('directory_type = "workspace"\n')).toBe(
      true,
    );
    expect(dgTomlLooksLikeWorkspace('directory_type = "project"\n')).toBe(
      false,
    );
  });

  it("finds dg.toml project", async () => {
    const root = await mkdtemp(join(tmpdir(), "pi-dagster-proj-"));
    await writeFile(join(root, "dg.toml"), 'directory_type = "project"\n');
    await mkdir(join(root, "defs"));
    const nested = join(root, "src", "pkg");
    await mkdir(nested, { recursive: true });

    const d = await discoverProject(nested);
    expect(d).not.toBeNull();
    expect(d!.root).toBe(root);
    expect(d!.kind).toBe("project");
    expect(d!.markers).toContain("dg.toml");
    expect(d!.markers).toContain("defs/");
  });

  it("finds workspace dg.toml", async () => {
    const root = await mkdtemp(join(tmpdir(), "pi-dagster-ws-"));
    await writeFile(
      join(root, "dg.toml"),
      'directory_type = "workspace"\n\n[workspace]\n',
    );
    const d = await discoverProject(root);
    expect(d!.kind).toBe("workspace");
  });

  it("finds pyproject [tool.dg]", async () => {
    const root = await mkdtemp(join(tmpdir(), "pi-dagster-py-"));
    await writeFile(
      join(root, "pyproject.toml"),
      '[project]\nname="x"\n\n[tool.dg]\ndirectory_type = "project"\n',
    );
    const d = await discoverProject(root);
    expect(d!.kind).toBe("project");
    expect(d!.markers.some((m) => m.includes("tool.dg"))).toBe(true);
  });

  it("returns null when no markers", async () => {
    const root = await mkdtemp(join(tmpdir(), "pi-dagster-empty-"));
    const d = await discoverProject(root, { maxDepth: 2 });
    expect(d).toBeNull();
  });

  it("resolveProjectRoot prefers profile path when it exists", async () => {
    const root = await mkdtemp(join(tmpdir(), "pi-dagster-pref-"));
    await writeFile(join(root, "dg.toml"), 'directory_type = "project"\n');
    const other = await mkdtemp(join(tmpdir(), "pi-dagster-cwd-"));
    const { root: resolved } = await resolveProjectRoot({
      cwd: other,
      profileProjectRoot: root,
    });
    expect(resolved).toBe(root);
  });
});

describe("source-paths", () => {
  it("resolveUnderProject rejects escapes", () => {
    const root = "/tmp/proj";
    expect(resolveUnderProject(root, "defs/foo.py")).toContain("defs");
    expect(() => resolveUnderProject(root, "../outside")).toThrow(/escapes/);
  });

  it("defsDir and resolveDefsPath", () => {
    expect(defsDir("/tmp/proj")).toBe(join("/tmp/proj", "defs"));
    expect(resolveDefsPath("/tmp/proj", "my_comp")).toBe(
      join("/tmp/proj", "defs", "my_comp"),
    );
    expect(resolveDefsPath("/tmp/proj", "defs/my_comp")).toBe(
      join("/tmp/proj", "defs", "my_comp"),
    );
  });
});
