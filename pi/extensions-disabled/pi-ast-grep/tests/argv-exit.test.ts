import assert from "node:assert/strict";
import test from "node:test";
import { buildInspectArgv, buildOutlineArgv, buildSearchArgv } from "../src/ast-grep/argv.js";
import { classifyExitCode } from "../src/ast-grep/client.js";

test("outline argv is exact, argv-only, and project-relative", () => {
  assert.deepEqual(buildOutlineArgv({
    cwd: "/work/project",
    language: "ts",
    sgConfigPath: "/work/project/sgconfig.yml",
    paths: ["src", "file with spaces.ts"],
  }), [
    "outline", "--json=stream", "--color=never", "--lang", "ts",
    "--config", "/work/project/sgconfig.yml", "--", "src", "file with spaces.ts",
  ]);
});

test("search and inspect keep patterns as one argv element", () => {
  const pattern = "$A; echo not-a-shell";
  assert.deepEqual(buildSearchArgv({ cwd: "/work/project", pattern, language: "ts" }), [
    "run", "--pattern", pattern, "--json=stream", "--color=never", "--lang", "ts", "--", ".",
  ]);
  assert.deepEqual(buildInspectArgv({ cwd: "/work/project", pattern: "$A", language: "ts", mode: "cst" }), [
    "run", "--pattern", "$A", "--json=stream", "--color=never", "--lang", "ts",
    "--debug-query=cst", "--", ".",
  ]);
  assert.throws(
    () => buildOutlineArgv({ cwd: "/work/project", paths: ["../secret"] }),
    /outside the project cwd/u,
  );
});

test("exit code semantics distinguish no-match from failures", () => {
  assert.equal(classifyExitCode("search", 0), "success");
  assert.equal(classifyExitCode("search", 1), "no-match");
  assert.equal(classifyExitCode("inspect", 1), "no-match");
  assert.equal(classifyExitCode("outline", 1), "failure");
  assert.equal(classifyExitCode("search", 2), "failure");
  assert.equal(classifyExitCode("search", 6), "failure");
  assert.equal(classifyExitCode("search", 8), "failure");
});
