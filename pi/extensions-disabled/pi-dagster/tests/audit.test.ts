import { describe, expect, it, vi } from "vitest";
import {
  appendAudit,
  buildAuditEntry,
  sanitizeAuditText,
} from "../src/policy/audit.ts";
import { auditMutation } from "../src/tools/lazy/mutation-helpers.ts";

describe("audit", () => {
  it("buildAuditEntry never includes runConfig secrets", () => {
    const entry = buildAuditEntry({
      tool: "dagster_launch_run",
      risk: "remote_launch",
      profile: "dev",
      summary: "Launched run abc (no config)",
      entityIds: ["abc"],
      outcome: "success",
      endpoint: "http://localhost:3000/graphql",
    });
    expect(JSON.stringify(entry)).not.toMatch(/password|secret|token|runConfig/i);
    expect(entry.auditId).toMatch(/^audit-/);
    expect(entry.summary).toMatch(/abc/);
    expect(entry.endpoint).toBe("http://localhost:3000/graphql");
  });

  it("sanitizeAuditText redacts bearer tokens and cookie headers", () => {
    expect(sanitizeAuditText("Authorization: Bearer super.secret.token")).toMatch(
      /\[redacted\]/i,
    );
    const cookies = sanitizeAuditText(
      "Cookie: sessionid=opaque-value; theme=dark\nSet-Cookie: sessionid=opaque-value\nProxy-Authorization: Basic abc123",
    );
    expect(cookies).not.toContain("opaque-value");
    expect(cookies).not.toContain("Basic abc123");
    expect(cookies).toMatch(/Cookie:\s*\[REDACTED\]/i);
    expect(cookies).toMatch(/Set-Cookie:\s*\[REDACTED\]/i);
    expect(cookies).toMatch(/Proxy-Authorization:\s*\[REDACTED\]/i);
  });

  it("appendAudit calls pi.appendEntry", () => {
    const appendEntry = vi.fn();
    appendAudit({ appendEntry }, buildAuditEntry({
      tool: "dagster_terminate_run",
      risk: "remote_state",
      summary: "Terminated run x",
      outcome: "success",
    }));
    expect(appendEntry).toHaveBeenCalledWith(
      "dagster.audit",
      expect.objectContaining({ tool: "dagster_terminate_run" }),
    );
  });

  it("uses one stable id across the built entry", () => {
    const entry = buildAuditEntry({
      auditId: "audit-fixed",
      tool: "t",
      risk: "read",
      summary: "s",
      outcome: "success",
    });
    expect(entry.auditId).toBe("audit-fixed");
  });

  it("records runtime audit even when appendEntry throws", () => {
    const recordAudit = vi.fn();
    const runtime = {
      activeProfileName: "dev",
      getClient: () => null,
      getEphemeralGraphqlUrl: () => null,
      recordAudit,
      pi: { appendEntry: () => { throw new Error("unavailable"); } },
    } as any;
    expect(() => auditMutation({
      runtime,
      tool: "dagster_launch_run",
      risk: "remote_launch",
      outcome: "success",
      summary: "launched r1",
      entityIds: ["r1"],
    })).not.toThrow();
    expect(recordAudit).toHaveBeenCalledWith(expect.objectContaining({ auditId: expect.stringMatching(/^audit-/) }));
  });

  it("appendAudit is best-effort when missing", () => {
    expect(() =>
      appendAudit({}, buildAuditEntry({
        tool: "t",
        risk: "read",
        summary: "s",
        outcome: "success",
      })),
    ).not.toThrow();
  });
});
