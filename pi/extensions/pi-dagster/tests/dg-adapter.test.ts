import { describe, expect, it } from "vitest";
import {
  assertDgAllowlisted,
  assertNotDevViaCommandTool,
  classifyDgArgs,
  normalizeDgCommand,
  resolveDgArgv,
  runDg,
  splitCommandString,
  truncateCliCapture,
  type DgSpawnRunner,
} from "../src/clients/dg.ts";

describe("allowlist", () => {
  it("accepts check/list/scaffold/launch", () => {
    expect(() => assertDgAllowlisted(["check", "defs"])).not.toThrow();
    expect(() => assertDgAllowlisted(["list", "components"])).not.toThrow();
    expect(() =>
      assertDgAllowlisted(["scaffold", "defs", "foo"]),
    ).not.toThrow();
    expect(() =>
      assertDgAllowlisted(["launch", "--assets", "a"]),
    ).not.toThrow();
    expect(() => assertDgAllowlisted(["dev"])).not.toThrow(); // allowlist includes dev
  });

  it("rejects plus, empty, shell-ish top tokens", () => {
    expect(() => assertDgAllowlisted([])).toThrow(/subcommand/);
    expect(() => assertDgAllowlisted(["plus"])).toThrow(/not allowlisted/);
    expect(() => assertDgAllowlisted(["api"])).toThrow(/not allowlisted/);
    expect(() => assertDgAllowlisted(["; rm -rf"])).toThrow(/unsafe|Rejected/);
  });

  it("Option A: rejects dev via command tool path", () => {
    expect(() => assertNotDevViaCommandTool(["dev"])).toThrow(/dagster-dev/);
  });
});

describe("classifyDgArgs", () => {
  it("scaffold → local_source; others → local_exec", () => {
    expect(classifyDgArgs(["scaffold", "defs", "x"])).toBe("local_source");
    expect(classifyDgArgs(["check", "defs"])).toBe("local_exec");
    expect(classifyDgArgs(["list", "defs"])).toBe("local_exec");
    expect(classifyDgArgs(["launch", "--job", "j"])).toBe("local_exec");
  });
});

describe("binary resolution", () => {
  it("profile dgCommand wins", async () => {
    const argv = await resolveDgArgv({
      dgCommand: ["uv", "run", "dg"],
      pathLookup: async () => false,
    });
    expect(argv).toEqual(["uv", "run", "dg"]);
  });

  it("string dgCommand splits carefully", () => {
    expect(splitCommandString("uv run dg")).toEqual(["uv", "run", "dg"]);
    expect(normalizeDgCommand('"/opt/bin/dg"')).toEqual(["/opt/bin/dg"]);
  });

  it("falls back to dg then uv run dg", async () => {
    const seen: string[] = [];
    const argv = await resolveDgArgv({
      pathLookup: async (bin) => {
        seen.push(bin);
        return bin === "uv";
      },
    });
    expect(argv).toEqual(["uv", "run", "dg"]);
    expect(seen).toContain("dg");
    expect(seen).toContain("uv");
  });

  it("throws when nothing found", async () => {
    await expect(
      resolveDgArgv({ pathLookup: async () => false }),
    ).rejects.toThrow(/Install dg/);
  });
});

describe("runDg", () => {
  it("returns structured non-zero exit", async () => {
    const runner: DgSpawnRunner = async () => ({
      exitCode: 1,
      signal: null,
      stdout: "validation failed\n",
      stderr: "error detail\n",
      durationMs: 12,
    });
    const result = await runDg({
      args: ["check", "defs"],
      cwd: "/tmp",
      dgArgv: ["dg"],
      runner,
    });
    expect(result.exitCode).toBe(1);
    expect(result.stdout).toContain("validation failed");
    expect(result.argv).toEqual(["dg", "check", "defs"]);
  });

  it("throws on abort via runner rejection", async () => {
    const runner: DgSpawnRunner = async () => {
      throw new Error("dg command aborted");
    };
    await expect(
      runDg({
        args: ["list", "defs"],
        cwd: "/tmp",
        dgArgv: ["dg"],
        runner,
      }),
    ).rejects.toThrow(/aborted/);
  });

  it("rejects non-allowlisted before spawn", async () => {
    let called = false;
    const runner: DgSpawnRunner = async () => {
      called = true;
      return {
        exitCode: 0,
        signal: null,
        stdout: "",
        stderr: "",
        durationMs: 0,
      };
    };
    await expect(
      runDg({
        args: ["plus", "login"],
        cwd: "/tmp",
        dgArgv: ["dg"],
        runner,
      }),
    ).rejects.toThrow(/not allowlisted/);
    expect(called).toBe(false);
  });

  it("rejects dev when rejectDev default", async () => {
    await expect(
      runDg({
        args: ["dev"],
        cwd: "/tmp",
        dgArgv: ["dg"],
        runner: async () => ({
          exitCode: 0,
          signal: null,
          stdout: "",
          stderr: "",
          durationMs: 0,
        }),
      }),
    ).rejects.toThrow(/dagster-dev/);
  });
});

describe("truncateCliCapture", () => {
  it("truncates huge output and sets paths", async () => {
    const huge = "x".repeat(60_000);
    const out = await truncateCliCapture(huge, "err", {
      maxBytes: 1000,
      maxLines: 10,
    });
    expect(out.truncated).toBe(true);
    expect(out.stdoutPath).toBeTruthy();
    expect(out.stderrPath).toBeTruthy();
    expect(out.stdout.length).toBeLessThan(huge.length);
  });

  it("passes through small output", async () => {
    const out = await truncateCliCapture("ok\n", "");
    expect(out.truncated).toBe(false);
    expect(out.stdout).toBe("ok\n");
  });
});
