import { describe, expect, it, vi } from "vitest";
import { EventEmitter } from "node:events";
import {
  createDgDevController,
  filterDevExtraArgs,
  type StartDgDevOptions,
} from "../src/clients/dg-dev.ts";
import { createRuntime } from "../src/runtime.ts";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

function fakeChild(pid = 4242) {
  const ee = new EventEmitter() as EventEmitter & {
    pid: number;
    killed: boolean;
    exitCode: number | null;
    stdout: EventEmitter;
    stderr: EventEmitter;
    kill: (sig?: NodeJS.Signals) => boolean;
  };
  ee.pid = pid;
  ee.killed = false;
  ee.exitCode = null;
  ee.stdout = new EventEmitter();
  ee.stderr = new EventEmitter();
  ee.kill = vi.fn(() => {
    ee.killed = true;
    ee.exitCode = null;
    queueMicrotask(() => ee.emit("close", 0, "SIGTERM"));
    return true;
  });
  return ee;
}

describe("filterDevExtraArgs", () => {
  it("allows known flags and rejects others", () => {
    expect(filterDevExtraArgs(["--log-level", "info"])).toEqual([
      "--log-level",
      "info",
    ]);
    expect(() => filterDevExtraArgs(["--evil"])).toThrow(/not allowlisted/);
  });
});

describe("createDgDevController", () => {
  it("start sets running after fake ready probe", async () => {
    const child = fakeChild();
    const controller = createDgDevController();
    const st = await controller.start({
      cwd: "/tmp/proj",
      host: "127.0.0.1",
      port: 3000,
      pathLookup: async (bin) => bin === "dg",
      readinessProbe: async () => true,
      spawnImpl: (() => child) as unknown as StartDgDevOptions["spawnImpl"],
      autoConnectGraphql: false,
    });
    expect(st.status).toBe("running");
    expect(st.port).toBe(3000);
    expect(st.graphqlUrl).toBe("http://127.0.0.1:3000/graphql");
    expect(st.pid).toBe(4242);

    // Double start same root is idempotent
    const again = await controller.start({
      cwd: "/tmp/proj",
      pathLookup: async () => true,
      readinessProbe: async () => true,
      spawnImpl: (() => fakeChild(9)) as unknown as StartDgDevOptions["spawnImpl"],
    });
    expect(again.status).toBe("running");
    expect(again.pid).toBe(4242);

    const stopped = await controller.stop();
    expect(stopped.status).toBe("stopped");
  });

  it("readiness timeout → error and kills child", async () => {
    const child = fakeChild(77);
    const controller = createDgDevController();
    const st = await controller.start({
      cwd: "/tmp/proj",
      pathLookup: async (bin) => bin === "dg",
      readinessProbe: async () => false,
      readyTimeoutMs: 50,
      spawnImpl: (() => child) as unknown as StartDgDevOptions["spawnImpl"],
      autoConnectGraphql: false,
    });
    expect(st.status).toBe("error");
    expect(st.lastError).toMatch(/timeout/i);
  });

  it("stop is idempotent when already stopped", async () => {
    const controller = createDgDevController();
    const st = await controller.stop();
    expect(st.status).toBe("stopped");
  });

  it("dispose clears state", async () => {
    const child = fakeChild();
    const controller = createDgDevController();
    await controller.start({
      cwd: "/tmp",
      pathLookup: async () => true,
      readinessProbe: async () => true,
      spawnImpl: (() => child) as unknown as StartDgDevOptions["spawnImpl"],
      autoConnectGraphql: false,
    });
    controller.dispose();
    expect(controller.getState().status).toBe("stopped");
  });
});

describe("runtime dg dev integration", () => {
  it("shutdown stops child via dispose", async () => {
    const runtime = createRuntime({ getFlag: () => undefined } as unknown as ExtensionAPI);
    runtime.setDgPathLookupForTests(async (bin) => bin === "dg");
    const child = fakeChild(1001);
    // Access startDgDev with injects
    const st = await runtime.startDgDev({
      cwd: "/tmp/proj",
      readinessProbe: async () => true,
      spawnImpl: (() => child) as unknown as StartDgDevOptions["spawnImpl"],
      autoConnectGraphql: true,
    });
    expect(st.status).toBe("running");
    expect(runtime.getEphemeralGraphqlUrl()).toBe(
      "http://127.0.0.1:3000/graphql",
    );
    runtime.shutdown();
    expect(runtime.closed).toBe(true);
    expect(runtime.getDgDevState().status).toBe("stopped");
  });
});
