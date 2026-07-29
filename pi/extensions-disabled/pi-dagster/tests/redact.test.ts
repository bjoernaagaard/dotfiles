import { describe, expect, it } from "vitest";
import { redactObject, redactYamlish } from "../src/policy/redact.ts";

describe("redactObject", () => {
  it("redacts nested secret keys", () => {
    const input = {
      table: "orders",
      credentials: { password: "s3cret", user: "admin" },
      nested: { api_key: "abc", safe: "ok" },
      token: "tok",
      list: [{ access_key: "x" }, { name: "y" }],
    };
    const out = redactObject(input) as typeof input;
    expect(out.table).toBe("orders");
    expect(out.credentials).toBe("[REDACTED]");
    expect(out.nested.api_key).toBe("[REDACTED]");
    expect(out.nested.safe).toBe("ok");
    expect(out.token).toBe("[REDACTED]");
    expect((out.list[0] as { access_key: string }).access_key).toBe("[REDACTED]");
    expect((out.list[1] as { name: string }).name).toBe("y");
  });
});

describe("redactYamlish", () => {
  it("redacts yaml-ish secret lines", () => {
    const yaml = [
      "ops:",
      "  my_op:",
      "    config:",
      "      password: s3cret",
      "      api_key: 'abc123'",
      "      table: orders",
      "TOKEN=bare-token",
      "authorization: Bearer xyz",
    ].join("\n");

    const out = redactYamlish(yaml);
    expect(out).toContain("password: [REDACTED]");
    expect(out).toContain('api_key: "[REDACTED]"');
    expect(out).toContain("table: orders");
    expect(out).toContain("TOKEN=[REDACTED]");
    expect(out).toContain("authorization: [REDACTED]");
    expect(out).not.toContain("s3cret");
    expect(out).not.toContain("abc123");
    expect(out).not.toContain("bare-token");
  });

  it("honors extra key patterns", () => {
    const out = redactYamlish("my_custom_secret: 123", ["my_custom_secret"]);
    expect(out).toBe("my_custom_secret: [REDACTED]");
  });

  it("preserves extraKeyPatterns inside nested config string blobs", () => {
    const blob = [
      "ops:",
      "  load:",
      "    config:",
      "      private_value: nested-secret-xyz",
      "      table: orders",
    ].join("\n");
    const out = redactObject(
      { runConfigYaml: blob, safe: "ok" },
      ["private_value"],
    ) as { runConfigYaml: string; safe: string };
    expect(out.safe).toBe("ok");
    expect(out.runConfigYaml).toContain("private_value: [REDACTED]");
    expect(out.runConfigYaml).toContain("table: orders");
    expect(out.runConfigYaml).not.toContain("nested-secret-xyz");
  });
});
