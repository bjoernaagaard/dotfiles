/**
 * Long-lived `dg dev` lifecycle helpers.
 * Child process is tracked only on the runtime instance (no process-global table).
 */
import { spawn, type ChildProcess } from "node:child_process";
import { createWriteStream, type WriteStream } from "node:fs";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createDefaultSpawnRunner, resolveDgArgv, type DgResolveOptions } from "./dg.ts";

export type DgDevStatus =
  | "stopped"
  | "starting"
  | "running"
  | "stopping"
  | "error";

export type DgDevState = {
  status: DgDevStatus;
  pid?: number;
  host?: string;
  port?: number;
  graphqlUrl?: string;
  projectRoot?: string;
  startedAt?: number;
  /** No secrets. */
  lastError?: string;
  logPath?: string;
  /** True when runtime ephemeral GraphQL URL was set by this session. */
  setEphemeralGraphql?: boolean;
};

export type StartDgDevOptions = {
  cwd: string;
  host?: string;
  port?: number;
  /** Allowlisted flags only: --port --host --log-level --live-data-poll-rate --check-yaml/--no-check-yaml */
  extraArgs?: string[];
  signal?: AbortSignal;
  /** When true (default), after ready set ephemeral graphql URL on runtime. */
  autoConnectGraphql?: boolean;
  dgCommand?: string | string[] | null;
  pathLookup?: DgResolveOptions["pathLookup"];
  pathEnv?: string;
  /** Inject readiness probe (tests). */
  readinessProbe?: (opts: {
    host: string;
    port: number;
    signal?: AbortSignal;
  }) => Promise<boolean>;
  /** Inject spawn for tests. */
  spawnImpl?: typeof spawn;
  /** Grace ms before SIGKILL on stop (default 5000). */
  stopGraceMs?: number;
  /** Ready wait timeout (default 90s). */
  readyTimeoutMs?: number;
};

export type DgDevController = {
  getState(): DgDevState;
  start(opts: StartDgDevOptions): Promise<DgDevState>;
  stop(opts?: { force?: boolean; signal?: AbortSignal }): Promise<DgDevState>;
  waitReady(opts?: {
    signal?: AbortSignal;
    timeoutMs?: number;
  }): Promise<{ graphqlUrl: string }>;
  /** Idempotent hard cleanup. */
  dispose(): void;
  /** Whether this controller set the ephemeral GraphQL URL. */
  didSetEphemeralGraphql(): boolean;
  clearEphemeralFlag(): void;
};

const ALLOWED_EXTRA_FLAGS = new Set([
  "--port",
  "-p",
  "--host",
  "-h",
  "--log-level",
  "--live-data-poll-rate",
  "--check-yaml",
  "--no-check-yaml",
  "--code-server-log-level",
  "--log-format",
]);

export function filterDevExtraArgs(extraArgs: string[] | undefined): string[] {
  if (!extraArgs?.length) return [];
  const out: string[] = [];
  for (let i = 0; i < extraArgs.length; i++) {
    const a = extraArgs[i]!;
    if (a.startsWith("-")) {
      const flag = a.includes("=") ? a.split("=")[0]! : a;
      if (!ALLOWED_EXTRA_FLAGS.has(flag)) {
        throw new Error(
          `dg dev flag not allowlisted: ${flag}. Allowed: ${[...ALLOWED_EXTRA_FLAGS].join(", ")}`,
        );
      }
      out.push(a);
      // If flag takes a value as next token (not --check-yaml style), keep it.
      if (
        !a.includes("=") &&
        flag !== "--check-yaml" &&
        flag !== "--no-check-yaml" &&
        extraArgs[i + 1] &&
        !extraArgs[i + 1]!.startsWith("-")
      ) {
        i++;
        out.push(extraArgs[i]!);
      }
    } else {
      throw new Error(`Unexpected positional arg for dg dev: ${a}`);
    }
  }
  return out;
}

export async function defaultReadinessProbe(opts: {
  host: string;
  port: number;
  signal?: AbortSignal;
  fetchImpl?: typeof fetch;
}): Promise<boolean> {
  const fetchImpl = opts.fetchImpl ?? globalThis.fetch.bind(globalThis);
  const url = `http://${opts.host}:${opts.port}/graphql`;
  try {
    const res = await fetchImpl(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({ query: "{ __typename }" }),
      signal: opts.signal,
    });
    if (!res.ok) return false;
    const json = (await res.json()) as { data?: { __typename?: string } };
    return Boolean(json?.data?.__typename);
  } catch {
    return false;
  }
}

function emptyState(): DgDevState {
  return { status: "stopped" };
}

/**
 * Create a per-runtime dg dev controller.
 */
export function createDgDevController(hooks?: {
  onStateChange?: (state: DgDevState) => void;
  onSetEphemeralGraphql?: (url: string | null) => void;
}): DgDevController {
  let state: DgDevState = emptyState();
  let child: ChildProcess | null = null;
  let logStream: WriteStream | null = null;
  let setEphemeral = false;

  const publish = () => {
    hooks?.onStateChange?.({ ...state });
  };

  const killChild = (sig: NodeJS.Signals) => {
    if (!child || child.killed) return;
    try {
      if (process.platform !== "win32" && child.pid) {
        process.kill(-child.pid, sig);
      } else {
        child.kill(sig);
      }
    } catch {
      try {
        child.kill(sig);
      } catch {
        // ignore
      }
    }
  };

  const closeLog = () => {
    try {
      logStream?.end();
    } catch {
      // ignore
    }
    logStream = null;
  };

  const controller: DgDevController = {
    getState() {
      return { ...state };
    },

    didSetEphemeralGraphql() {
      return setEphemeral;
    },

    clearEphemeralFlag() {
      setEphemeral = false;
    },

    async start(opts: StartDgDevOptions): Promise<DgDevState> {
      if (state.status === "running" || state.status === "starting") {
        // Idempotent when same root; otherwise clear message via lastError but return state.
        if (
          state.projectRoot &&
          opts.cwd &&
          resolveSameRoot(state.projectRoot, opts.cwd)
        ) {
          return { ...state };
        }
        return {
          ...state,
          lastError:
            state.lastError ??
            `dg dev already ${state.status} (root=${state.projectRoot ?? "?"}). Stop first.`,
        };
      }

      const host = opts.host ?? "127.0.0.1";
      const port = opts.port ?? 3000;
      const autoConnect = opts.autoConnectGraphql !== false;
      const extra = filterDevExtraArgs(opts.extraArgs);

      const dgArgv = await resolveDgArgv({
        dgCommand: opts.dgCommand,
        pathLookup: opts.pathLookup,
        pathEnv: opts.pathEnv,
      });

      const argv = [
        ...dgArgv,
        "dev",
        "--host",
        host,
        "--port",
        String(port),
        ...extra,
      ];

      const logDir = await mkdtemp(join(tmpdir(), "pi-dagster-dg-dev-"));
      const logPath = join(logDir, "dg-dev.log");
      logStream = createWriteStream(logPath, { flags: "a" });

      state = {
        status: "starting",
        host,
        port,
        projectRoot: opts.cwd,
        startedAt: Date.now(),
        logPath,
        graphqlUrl: `http://${host}:${port}/graphql`,
      };
      publish();

      const spawnImpl = opts.spawnImpl ?? spawn;
      const [bin, ...args] = argv;

      try {
        child = spawnImpl(bin!, args, {
          cwd: opts.cwd,
          env: process.env,
          stdio: ["ignore", "pipe", "pipe"],
          shell: false,
          detached: process.platform !== "win32",
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        state = {
          ...state,
          status: "error",
          lastError: `Failed to spawn dg dev: ${message}`,
        };
        closeLog();
        publish();
        return { ...state };
      }

      state.pid = child.pid;
      publish();

      const append = (chunk: Buffer | string) => {
        try {
          logStream?.write(chunk);
        } catch {
          // ignore
        }
      };
      child.stdout?.on("data", append);
      child.stderr?.on("data", append);

      child.on("error", (err) => {
        state = {
          ...state,
          status: "error",
          lastError: `dg dev process error: ${err.message}`,
        };
        publish();
      });

      child.on("close", (code, sig) => {
        if (state.status === "stopping") {
          state = {
            status: "stopped",
            logPath: state.logPath,
            lastError: state.lastError,
          };
        } else if (state.status === "starting" || state.status === "running") {
          state = {
            status: "error",
            logPath: state.logPath,
            lastError: `dg dev exited early (code=${code}, signal=${sig})`,
            projectRoot: state.projectRoot,
            host: state.host,
            port: state.port,
          };
        }
        child = null;
        closeLog();
        if (setEphemeral) {
          hooks?.onSetEphemeralGraphql?.(null);
          setEphemeral = false;
        }
        publish();
      });

      // Wait for readiness
      try {
        const ready = await waitForReady({
          host,
          port,
          signal: opts.signal,
          timeoutMs: opts.readyTimeoutMs ?? 90_000,
          probe: opts.readinessProbe,
        });
        if (!ready) {
          killChild("SIGTERM");
          setTimeout(() => killChild("SIGKILL"), 2000).unref?.();
          const tail = await tailLog(logPath, 30);
          state = {
            status: "error",
            logPath,
            projectRoot: opts.cwd,
            host,
            port,
            lastError: `dg dev readiness timeout. Last log lines:\n${tail}`,
          };
          child = null;
          closeLog();
          publish();
          return { ...state };
        }

        state = {
          status: "running",
          pid: child?.pid,
          host,
          port,
          graphqlUrl: `http://${host}:${port}/graphql`,
          projectRoot: opts.cwd,
          startedAt: state.startedAt,
          logPath,
        };
        if (autoConnect) {
          hooks?.onSetEphemeralGraphql?.(state.graphqlUrl!);
          setEphemeral = true;
          state.setEphemeralGraphql = true;
        }
        publish();
        return { ...state };
      } catch (err) {
        killChild("SIGTERM");
        setTimeout(() => killChild("SIGKILL"), 2000).unref?.();
        const message = err instanceof Error ? err.message : String(err);
        const tail = await tailLog(logPath, 30);
        state = {
          status: "error",
          logPath,
          projectRoot: opts.cwd,
          host,
          port,
          lastError: `${message}\n${tail}`.trim(),
        };
        child = null;
        closeLog();
        publish();
        return { ...state };
      }
    },

    async stop(opts?: { force?: boolean; signal?: AbortSignal }): Promise<DgDevState> {
      if (state.status === "stopped") {
        return { ...state };
      }
      if (!child && state.status !== "starting" && state.status !== "running") {
        state = { status: "stopped", logPath: state.logPath, lastError: state.lastError };
        publish();
        return { ...state };
      }

      state = { ...state, status: "stopping" };
      publish();

      const grace = 5000;
      killChild(opts?.force ? "SIGKILL" : "SIGTERM");

      await waitForChildExit(child, grace);
      if (child && !child.killed) {
        killChild("SIGKILL");
        await waitForChildExit(child, 2000);
      }

      child = null;
      closeLog();
      if (setEphemeral) {
        hooks?.onSetEphemeralGraphql?.(null);
        setEphemeral = false;
      }
      state = {
        status: "stopped",
        logPath: state.logPath,
      };
      publish();
      return { ...state };
    },

    async waitReady(opts?: {
      signal?: AbortSignal;
      timeoutMs?: number;
    }): Promise<{ graphqlUrl: string }> {
      if (state.status === "running" && state.graphqlUrl) {
        return { graphqlUrl: state.graphqlUrl };
      }
      if (state.status !== "starting" && state.status !== "running") {
        throw new Error(`dg dev is not starting/running (status=${state.status})`);
      }
      const host = state.host ?? "127.0.0.1";
      const port = state.port ?? 3000;
      const ok = await waitForReady({
        host,
        port,
        signal: opts?.signal,
        timeoutMs: opts?.timeoutMs ?? 90_000,
      });
      if (!ok || !state.graphqlUrl) {
        throw new Error("dg dev not ready");
      }
      return { graphqlUrl: state.graphqlUrl };
    },

    dispose() {
      try {
        if (child) {
          killChild("SIGTERM");
          killChild("SIGKILL");
        }
      } catch {
        // ignore
      }
      child = null;
      closeLog();
      if (setEphemeral) {
        hooks?.onSetEphemeralGraphql?.(null);
        setEphemeral = false;
      }
      state = emptyState();
    },
  };

  // silence unused import when tree-shaken differently
  void createDefaultSpawnRunner;

  return controller;
}

function resolveSameRoot(a: string, b: string): boolean {
  return join(a) === join(b);
}

async function waitForReady(opts: {
  host: string;
  port: number;
  signal?: AbortSignal;
  timeoutMs: number;
  probe?: StartDgDevOptions["readinessProbe"];
}): Promise<boolean> {
  const probe = opts.probe ?? ((p) => defaultReadinessProbe(p));
  const deadline = Date.now() + opts.timeoutMs;
  while (Date.now() < deadline) {
    if (opts.signal?.aborted) {
      throw new Error("dg dev readiness aborted");
    }
    const ok = await probe({
      host: opts.host,
      port: opts.port,
      signal: opts.signal,
    });
    if (ok) return true;
    await sleep(500, opts.signal);
  }
  return false;
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new Error("aborted"));
      return;
    }
    const t = setTimeout(resolve, ms);
    const onAbort = () => {
      clearTimeout(t);
      reject(new Error("aborted"));
    };
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

function waitForChildExit(
  child: ChildProcess | null,
  graceMs: number,
): Promise<void> {
  if (!child || child.exitCode !== null || child.killed) {
    return Promise.resolve();
  }
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(), graceMs);
    child.once("close", () => {
      clearTimeout(timer);
      resolve();
    });
  });
}

async function tailLog(path: string, lines: number): Promise<string> {
  try {
    const text = await readFile(path, "utf8");
    const parts = text.split(/\r?\n/);
    return parts.slice(-lines).join("\n");
  } catch {
    return "(no log)";
  }
}
