import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { cpus, platform, release } from "node:os";
import { join } from "node:path";
import { performance } from "node:perf_hooks";
import { promisify } from "node:util";
import { AstGrepClient } from "../src/ast-grep/client.js";
import { buildCodemodApplyArgv } from "../src/ast-grep/argv.js";
import { NodeSpawnExecAdapter } from "../src/ast-grep/node-exec.js";
import { DEFAULT_LIMITS, type AstGrepConfig } from "../src/config.js";

const SAMPLES = 21;
const WARMUPS = 3;
const FILES = 16;
const MATCHES_PER_FILE = 24;
const executable = "ast-grep";
const execFileAsync = promisify(execFile);
const selector = {
  queryKind: "pattern" as const,
  pattern: "$A == null",
  rewrite: "$A === null",
  language: "ts",
  paths: ["src"],
};

interface Arm {
  readonly name: "native" | "extension";
  readonly root: string;
  readonly adapter: NodeSpawnExecAdapter;
  readonly run: () => Promise<void>;
}

async function main(): Promise<void> {
  const parent = await mkdtemp(join(tmpdir(), "pi-ast-grep-bench-"));
  try {
    const nativeRoot = join(parent, "native");
    const extensionRoot = join(parent, "extension");
    await Promise.all([prepareTree(nativeRoot), prepareTree(extensionRoot)]);
    const nativeAdapter = new NodeSpawnExecAdapter();
    const extensionAdapter = new NodeSpawnExecAdapter();
    const nativeArgv = buildCodemodApplyArgv({ cwd: nativeRoot, ...selector });
    const extensionClient = new AstGrepClient(extensionAdapter, config(extensionRoot));
    const native: Arm = {
      name: "native",
      root: nativeRoot,
      adapter: nativeAdapter,
      run: async () => {
        const result = await nativeAdapter.exec(executable, nativeArgv, { cwd: nativeRoot, timeout: DEFAULT_LIMITS.timeoutMs });
        if (result.killed || result.code !== 0) throw new Error(`native arm failed: code=${result.code} killed=${result.killed}\n${result.stderr}`);
      },
    };
    const extension: Arm = {
      name: "extension",
      root: extensionRoot,
      adapter: extensionAdapter,
      run: async () => {
        const result = await extensionClient.applyCodemod({ cwd: extensionRoot, ...selector });
        if (result.outcome !== "applied" || result.subprocessCount !== 1) throw new Error(`extension arm failed: ${result.outcome}`);
      },
    };

    for (let index = 0; index < WARMUPS; index += 1) {
      for (const arm of index % 2 === 0 ? [native, extension] : [extension, native]) await timedSample(arm, false);
    }

    const beforeNative = nativeAdapter.launches;
    const beforeExtension = extensionAdapter.launches;
    const samples = { native: [] as number[], extension: [] as number[] };
    const order: string[] = [];
    for (let index = 0; index < SAMPLES; index += 1) {
      const arms = index % 2 === 0 ? [native, extension] : [extension, native];
      for (const arm of arms) {
        order.push(arm.name);
        samples[arm.name].push(await timedSample(arm, true));
      }
    }
    const nativeProcesses = nativeAdapter.launches - beforeNative;
    const extensionProcesses = extensionAdapter.launches - beforeExtension;
    if (nativeProcesses !== SAMPLES || extensionProcesses !== SAMPLES) {
      throw new Error(`process-count gate failed: native=${nativeProcesses}, extension=${extensionProcesses}, expected=${SAMPLES}`);
    }

    await Promise.all([restoreTree(nativeRoot), restoreTree(extensionRoot)]);
    await Promise.all([native.run(), extension.run()]);
    const nativeBytes = await finalBytes(nativeRoot);
    const extensionBytes = await finalBytes(extensionRoot);
    if (!nativeBytes.equals(extensionBytes)) throw new Error("native and extension final file bytes differ");

    const nativeMedian = median(samples.native);
    const extensionMedian = median(samples.extension);
    const delta = extensionMedian - nativeMedian;
    const allowance = Math.max(nativeMedian * 0.05, 20);
    const { stdout: versionOutput } = await execFileAsync(executable, ["--version"]);
    const report = {
      gate: { passed: delta <= allowance, allowanceMs: allowance },
      samples: SAMPLES,
      warmups: WARMUPS,
      nativeMedianMs: nativeMedian,
      extensionMedianMs: extensionMedian,
      deltaMs: delta,
      ratio: extensionMedian / nativeMedian,
      nativeP95Ms: percentile(samples.native, 0.95),
      extensionP95Ms: percentile(samples.extension, 0.95),
      rawSamplesMs: samples,
      fixture: {
        files: FILES,
        bytes: Buffer.byteLength(sourceText()) * FILES,
        matches: FILES * MATCHES_PER_FILE,
      },
      executable,
      argv: nativeArgv,
      subprocessCount: { native: nativeProcesses, extension: extensionProcesses },
      versions: {
        node: process.version,
        os: `${platform()} ${release()}`,
        cpu: cpus()[0]?.model ?? "unknown",
        astGrep: versionOutput.trim(),
      },
      ordering: order,
    };
    console.log(JSON.stringify(report, null, 2));
    if (!report.gate.passed) {
      throw new Error(`benchmark gate failed: delta ${delta.toFixed(3)}ms exceeds ${allowance.toFixed(3)}ms`);
    }
  } finally {
    await rm(parent, { recursive: true, force: true });
  }
}

async function timedSample(arm: Arm, verify: boolean): Promise<number> {
  await restoreTree(arm.root);
  const launches = arm.adapter.launches;
  const started = performance.now();
  await arm.run();
  const elapsed = performance.now() - started;
  if (arm.adapter.launches !== launches + 1) throw new Error(`${arm.name} sample did not launch exactly one process`);
  if (verify) {
    const first = await readFile(join(arm.root, "src", "file-000.ts"), "utf8");
    if (first.includes(" == null") || !first.includes(" === null")) throw new Error(`${arm.name} sample produced incorrect bytes`);
  }
  return elapsed;
}

async function prepareTree(root: string): Promise<void> {
  await mkdir(join(root, "src"), { recursive: true });
  await restoreTree(root);
}

async function restoreTree(root: string): Promise<void> {
  const source = sourceText();
  await Promise.all(Array.from({ length: FILES }, (_, index) =>
    writeFile(join(root, "src", `file-${String(index).padStart(3, "0")}.ts`), source)));
}

function sourceText(): string {
  return Array.from({ length: MATCHES_PER_FILE }, (_, index) => `export const value${index} = input${index} == null;`).join("\n") + "\n";
}

async function finalBytes(root: string): Promise<Buffer> {
  const files = await Promise.all(Array.from({ length: FILES }, (_, index) =>
    readFile(join(root, "src", `file-${String(index).padStart(3, "0")}.ts`))));
  return Buffer.concat(files);
}

function config(root: string): AstGrepConfig {
  return {
    executable,
    limits: DEFAULT_LIMITS,
    discoverSgConfig: false,
    profile: false,
    statusStyle: "ascii",
    globalConfigPath: join(root, "agent", "ast-grep.json"),
    globalConfigLoaded: false,
    projectConfigPath: join(root, ".pi", "ast-grep.json"),
    projectConfigLoaded: false,
    diagnostics: [],
  };
}

function median(values: readonly number[]): number {
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.floor(sorted.length / 2)]!;
}

function percentile(values: readonly number[], percentileValue: number): number {
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * percentileValue) - 1)]!;
}

await main();
