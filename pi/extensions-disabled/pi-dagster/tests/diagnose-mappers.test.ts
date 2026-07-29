import { describe, expect, it } from "vitest";
import fixture from "./fixtures/graphql/diagnose/run-failure.json" with { type: "json" };
import {
  extractLogsCapturedKeys,
  mapCapturedLogs,
  mapDiagnosticRunOrError,
  mapFailureEvents,
  mapStepEvents,
  sanitizeDiagnosticText,
} from "../src/domain/diagnose.ts";

const node = fixture.runOrError;
const events = node.eventConnection.events;

describe("diagnose mappers", () => {
  it("maps partition, stable step events, failure chain, and capture key", () => {
    const run = mapDiagnosticRunOrError(fixture);
    expect(run.ok && run.run.partition).toBe("2026-01-01");
    expect(run.ok && run.run.tags.find((x) => x.key === "api_token")?.value).toBe("[REDACTED]");

    const failures = mapFailureEvents(events);
    expect(failures).toHaveLength(1);
    expect(failures[0]?.errorChain?.map((x) => x.message)).toContain("database unavailable");
    expect(JSON.stringify(failures)).not.toContain("fixture-super-secret");

    const steps = mapStepEvents([...events, events[0]]);
    expect(steps.map((x) => x.timestamp)).toEqual(steps.map((x) => x.timestamp).sort());
    expect(steps.filter((x) => x.summary === "Started load")).toHaveLength(1);

    expect(extractLogsCapturedKeys(events)).toEqual([
      expect.objectContaining({ fileKey: "load-file", stepKeys: ["load"] }),
    ]);
  });

  it("represents available, empty, external, and unavailable logs explicitly", () => {
    const key = { fileKey: "f", stepKeys: [], external: false };
    expect(mapCapturedLogs({ runOrError: { __typename: "Run", capturedLogs: { stdout: "", stderr: "" } } }, key).availability).toBe("empty");
    expect(mapCapturedLogs({ runOrError: { __typename: "Run", capturedLogs: { stdout: null, stderr: null } } }, { ...key, external: true }).availability).toBe("external");
    expect(mapCapturedLogs({ runOrError: { __typename: "PythonError", message: "no logs" } }, key).availability).toBe("unavailable");
  });

  it("redacts adversarial free-form secrets before formatting", () => {
    const safe = sanitizeDiagnosticText(
      "Authorization: Bearer abc.def.ghi password=hunter2 api_key='xyz' Cookie: sessionid=opaque-cookie Set-Cookie: sid=xyz Proxy-Authorization: Basic abc",
    );
    expect(safe).not.toContain("opaque-cookie");
    expect(safe).not.toContain("sid=xyz");
    expect(safe).not.toContain("Basic abc");
    expect(safe).not.toMatch(/abc\.def|hunter2|xyz/);
  });

  it("handles missing partition", () => {
    const copy = structuredClone(fixture) as any;
    copy.runOrError.tags = [];
    const result = mapDiagnosticRunOrError(copy);
    expect(result.ok && result.run.partition).toBeUndefined();
  });
});
