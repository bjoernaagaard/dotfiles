import { strict as assert } from "node:assert";
import { test } from "node:test";
import { runCommand } from "../src/runner.js";

const base = {
  cwd: process.cwd(),
  timeoutMs: 5_000,
  maxOutputBytes: 50 * 1024,
};

test("runner passes arguments without shell interpolation", async () => {
  const result = await runCommand({
    ...base,
    command: process.execPath,
    args: ["-e", "process.stdout.write(process.argv[1])", "hello world; not shell syntax"],
  });

  assert.equal(result.code, 0);
  assert.equal(result.stdout, "hello world; not shell syntax");
  assert.equal(result.stderr, "");
});

test("runner bounds combined output", async () => {
  const result = await runCommand({
    ...base,
    command: process.execPath,
    args: ["-e", "process.stdout.write('x'.repeat(10000))"],
    maxOutputBytes: 1024,
  });

  assert.equal(result.code, 0);
  assert.equal(result.stdout.length, 1024);
  assert.equal(result.truncated, true);
});

test("runner enforces timeout", async () => {
  const result = await runCommand({
    ...base,
    command: process.execPath,
    args: ["-e", "setTimeout(() => {}, 10000)"],
    timeoutMs: 100,
  });

  assert.equal(result.timedOut, true);
  assert.equal(result.killed, true);
});
