import assert from "node:assert/strict";
import { rm } from "node:fs/promises";
import { dirname } from "node:path";
import test from "node:test";
import { DEFAULT_LIMITS } from "../src/config.js";
import { AstGrepClient, AstGrepClientError } from "../src/ast-grep/client.js";
import { FakeExec, testConfig } from "./helpers.js";
import { boundOutput, formatSearch } from "../src/output.js";

const config = testConfig;

const MATCH = JSON.stringify({
  text: "return a + b;",
  range: {
    byteOffset: { start: 58, end: 71 },
    start: { line: 2, column: 2 },
    end: { line: 2, column: 15 },
  },
  file: "/work/project/src/a.ts",
  lines: "  return a + b;",
  charCount: { leading: 2, trailing: 0 },
  language: "TypeScript",
  metaVariables: {
    single: {
      A: {
        text: "a",
        range: { byteOffset: { start: 65, end: 66 }, start: { line: 2, column: 9 }, end: { line: 2, column: 10 } },
      },
    },
    multi: {},
    transformed: {},
  },
});

test("client normalizes search output and forwards timeout/cancellation", async () => {
  const exec = new FakeExec();
  exec.result = { stdout: `${MATCH}\n`, stderr: "", code: 0, killed: false };
  const client = new AstGrepClient(exec, config());
  const controller = new AbortController();
  const result = await client.search({
    cwd: "/work/project",
    pattern: "return $A + $B",
    language: "ts",
    paths: ["src"],
    signal: controller.signal,
  });
  assert.equal(result.matches[0]?.file, "src/a.ts");
  assert.deepEqual(result.matches[0]?.range.bytes, { start: 58, end: 71 });
  assert.equal(exec.calls[0]?.options?.timeout, 30_000);
  assert.equal(exec.calls[0]?.options?.signal, controller.signal);
  assert.deepEqual(exec.calls[0]?.args.slice(0, 3), ["run", "--pattern", "return $A + $B"]);
});

test("client treats run exit 1 as no-match and argument errors as failures", async () => {
  const exec = new FakeExec();
  const client = new AstGrepClient(exec, config());
  exec.result = { stdout: "", stderr: "", code: 1, killed: false };
  const noMatch = await client.search({ cwd: "/work/project", pattern: "$A", language: "ts" });
  assert.equal(noMatch.operation.outcome, "no-match");
  assert.deepEqual(noMatch.matches, []);

  exec.result = { stdout: "", stderr: "error: bad language", code: 2, killed: false };
  await assert.rejects(
    client.search({ cwd: "/work/project", pattern: "$A", language: "bad" }),
    (error) => error instanceof AstGrepClientError && error.kind === "exit" && error.exitCode === 2,
  );
});

test("stderr diagnostic severity classification is case-insensitive for ERROR:/WARNING:", async () => {
  const exec = new FakeExec();
  const client = new AstGrepClient(exec, config());

  exec.result = { stdout: "", stderr: "ERROR: unexpected token", code: 1, killed: false };
  const errorCase = await client.search({ cwd: "/work/project", pattern: "$A", language: "ts" });
  assert.equal(errorCase.diagnostics[0]?.severity, "error");

  exec.result = { stdout: "", stderr: "WARNING: deprecated flag", code: 1, killed: false };
  const warningCase = await client.search({ cwd: "/work/project", pattern: "$A", language: "ts" });
  assert.equal(warningCase.diagnostics[0]?.severity, "warning");

  exec.result = { stdout: "", stderr: "note: something else", code: 1, killed: false };
  const infoCase = await client.search({ cwd: "/work/project", pattern: "$A", language: "ts" });
  assert.equal(infoCase.diagnostics[0]?.severity, "info");
});

test("client separates inspect stderr and probes verified capability", async () => {
  const exec = new FakeExec();
  const client = new AstGrepClient(exec, config());
  exec.result = { stdout: "", stderr: "Debug CST:\nprogram", code: 1, killed: false };
  const inspected = await client.inspect({ cwd: "/work/project", pattern: "$A", language: "ts", mode: "cst" });
  assert.equal(inspected.queryTree, "Debug CST:\nprogram");
  assert.equal(inspected.operation.outcome, "no-match");

  exec.result = { stdout: "ast-grep 0.44.1\n", stderr: "", code: 0, killed: false };
  const capabilities = await client.probe();
  assert.equal(capabilities.verifiedContract, true);
  assert.deepEqual(capabilities.debugQueryModes, ["pattern", "ast", "cst"]);
});

test("killed commands distinguish timeout and cancellation", async () => {
  const exec = new FakeExec();
  exec.result = { stdout: "", stderr: "", code: 1, killed: true };
  const client = new AstGrepClient(exec, config());
  await assert.rejects(
    client.search({ cwd: "/work/project", pattern: "$A", language: "ts" }),
    (error) => error instanceof AstGrepClientError && error.kind === "timeout",
  );
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(
    client.search({ cwd: "/work/project", pattern: "$A", language: "ts", signal: controller.signal }),
    (error) => error instanceof AstGrepClientError && error.kind === "cancelled",
  );
});

test("process output between model and process limits is accepted then model-truncatable", async (t) => {
  const exec = new FakeExec();
  // ~80 KiB of valid NDJSON: above model maxOutputBytes (50 KiB), well under process default (10 MiB).
  const pad = "x".repeat(400);
  const record = JSON.stringify({
    text: pad,
    range: {
      byteOffset: { start: 0, end: pad.length },
      start: { line: 0, column: 0 },
      end: { line: 0, column: pad.length },
    },
    file: "/work/project/src/a.ts",
    lines: pad,
    charCount: { leading: 0, trailing: 0 },
    language: "TypeScript",
    metaVariables: { single: {}, multi: {}, transformed: {} },
  });
  const stdout = Array.from({ length: 180 }, () => record).join("\n") + "\n";
  const processBytes = Buffer.byteLength(stdout);
  assert.ok(processBytes > DEFAULT_LIMITS.maxOutputBytes);
  assert.ok(processBytes < DEFAULT_LIMITS.maxProcessOutputBytes);

  exec.result = { stdout, stderr: "", code: 0, killed: false };
  const cfg = config();
  const client = new AstGrepClient(exec, cfg);
  const result = await client.search({ cwd: "/work/project", pattern: "$A", language: "ts" });
  assert.equal(result.matches.length, 180);

  const formatted = formatSearch(result);
  assert.ok(Buffer.byteLength(formatted) > cfg.limits.maxOutputBytes);
  const output = await boundOutput(formatted, {
    maxBytes: cfg.limits.maxOutputBytes,
    maxLines: cfg.limits.maxOutputLines,
    spoolPrefix: "pi-ast-grep-client-test-",
  });
  assert.equal(output.truncation.truncated, true);
  assert.ok(output.spool);
  t.after(() => rm(dirname(output.spool!.path), { recursive: true, force: true }));
});

test("process output over process limits is rejected before parse", async () => {
  const exec = new FakeExec();
  const cfg = {
    ...config(),
    limits: {
      ...DEFAULT_LIMITS,
      maxProcessOutputBytes: 1_024,
      maxProcessOutputLines: 50,
    },
  };
  const client = new AstGrepClient(exec, cfg);

  exec.result = { stdout: `${"y".repeat(2_000)}\n`, stderr: "", code: 0, killed: false };
  await assert.rejects(
    client.search({ cwd: "/work/project", pattern: "$A", language: "ts" }),
    (error) =>
      error instanceof AstGrepClientError
      && error.kind === "execution"
      && /process output .*bytes exceeds configured limit 1024/u.test(error.message),
  );

  exec.result = {
    stdout: Array.from({ length: 60 }, (_, index) => JSON.stringify({ n: index })).join("\n") + "\n",
    stderr: "",
    code: 0,
    killed: false,
  };
  await assert.rejects(
    client.search({ cwd: "/work/project", pattern: "$A", language: "ts" }),
    (error) =>
      error instanceof AstGrepClientError
      && error.kind === "execution"
      && /process output .*lines exceeds configured limit 50/u.test(error.message),
  );
});
