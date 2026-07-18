import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it, vi } from "vitest";
import { createRuntime } from "../src/runtime.ts";
import { launchRunCore } from "../src/tools/lazy/launch-run.ts";
import { mapLaunchRunResult } from "../src/domain/mutations.ts";

const here = dirname(fileURLToPath(import.meta.url));
const fixture = (name: string) =>
  JSON.parse(readFileSync(join(here, "fixtures/graphql/mutations", name), "utf8"));

function mockPi() {
  return {
    appendEntry: vi.fn(),
    setStatus: vi.fn(),
  } as never;
}

describe("mapLaunchRunResult", () => {
  it("maps success", () => {
    const outcome = mapLaunchRunResult(fixture("launch-ok.json").data);
    expect(outcome.ok).toBe(true);
    if (outcome.ok) {
      expect(outcome.entityIds).toContain("abc-123");
      expect(outcome.summary).toMatch(/abc-123/);
    }
  });

  it("maps PythonError union", () => {
    const outcome = mapLaunchRunResult(fixture("launch-python-error.json").data);
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) {
      expect(outcome.error.kind).toBe("PythonError");
      expect(outcome.error.message).toBe("boom");
    }
  });
});

describe("launchRunCore policy", () => {
  it("blocks under readOnly", async () => {
    const runtime = createRuntime(mockPi());
    runtime.upsertProfile({
      name: "ro",
      graphqlHttp: "http://localhost:3000/graphql",
      policy: "readOnly",
      defaultLocation: "loc",
      defaultRepository: "__repository__",
    });
    runtime.setActiveProfile("ro");

    await expect(
      launchRunCore(
        runtime,
        { jobName: "j", force: true },
        undefined,
        { hasUI: false },
      ),
    ).rejects.toThrow(/Blocked by policy/);
  });

  it("launches on success with force in non-UI", async () => {
    const ok = fixture("launch-ok.json");
    const fetchImpl = vi.fn(async () =>
      new Response(JSON.stringify(ok), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );
    // Patch global fetch used by client
    const prev = globalThis.fetch;
    globalThis.fetch = fetchImpl as unknown as typeof fetch;

    try {
      const runtime = createRuntime(mockPi());
      runtime.upsertProfile({
        name: "dev",
        graphqlHttp: "http://localhost:3000/graphql",
        policy: "confirmMutations",
        defaultLocation: "loc",
        defaultRepository: "__repository__",
      });
      runtime.setActiveProfile("dev");

      const result = await launchRunCore(
        runtime,
        { jobName: "my_job", force: true },
        undefined,
        { hasUI: false },
      );
      expect(result.content[0]).toMatchObject({ type: "text" });
      expect((result.content[0] as { text: string }).text).toMatch(/abc-123/);
      expect(result.details).toMatchObject({ kind: "mutation_ok" });
      expect(fetchImpl).toHaveBeenCalled();
    } finally {
      globalThis.fetch = prev;
    }
  });
});
