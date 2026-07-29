import { describe, expect, it } from "vitest";
import { assertAllowed, isAboveRead } from "../src/policy/risk.ts";
import { classifyTool, LAZY_STUB_NAMES } from "../src/tools/catalog.ts";
import { classifyDgArgs } from "../src/clients/dg.ts";
import type { RiskClass } from "../src/policy/types.ts";

describe("assertAllowed", () => {
  it("allows read", () => {
    expect(
      assertAllowed({ risk: "read", policy: "confirmMutations", hasUI: true }),
    ).toBe("allow");
    expect(
      assertAllowed({ risk: "read", policy: "readOnly", hasUI: false }),
    ).toBe("allow");
  });

  it("blocks destructive without UI and without force", () => {
    expect(
      assertAllowed({ risk: "destructive", policy: "allowMutations", hasUI: false }),
    ).toBe("block");
    expect(
      assertAllowed({
        risk: "destructive",
        policy: "allowMutations",
        hasUI: false,
        force: true,
      }),
    ).toBe("allow");
  });

  it("requires confirm for destructive when UI is present", () => {
    expect(
      assertAllowed({ risk: "destructive", policy: "allowMutations", hasUI: true }),
    ).toBe("confirm");
    expect(
      assertAllowed({ risk: "destructive", policy: "confirmMutations", hasUI: true }),
    ).toBe("confirm");
  });

  it("readOnly profile blocks above read", () => {
    const aboveRead: RiskClass[] = [
      "local_source",
      "local_exec",
      "remote_launch",
      "remote_state",
      "destructive",
      "secret",
      "infra",
    ];
    for (const risk of aboveRead) {
      expect(isAboveRead(risk)).toBe(true);
      expect(assertAllowed({ risk, policy: "readOnly", hasUI: true })).toBe("block");
      expect(assertAllowed({ risk, policy: "readOnly", hasUI: false, force: true })).toBe(
        "block",
      );
    }
  });

  it("confirmMutations blocks non-read without UI unless force", () => {
    expect(
      assertAllowed({ risk: "remote_launch", policy: "confirmMutations", hasUI: false }),
    ).toBe("block");
    expect(
      assertAllowed({
        risk: "remote_launch",
        policy: "confirmMutations",
        hasUI: false,
        force: true,
      }),
    ).toBe("allow");
    expect(
      assertAllowed({ risk: "remote_launch", policy: "confirmMutations", hasUI: true }),
    ).toBe("confirm");
  });

  it("allowMutations allows non-destructive mutations", () => {
    expect(
      assertAllowed({ risk: "remote_launch", policy: "allowMutations", hasUI: false }),
    ).toBe("allow");
    expect(
      assertAllowed({ risk: "local_exec", policy: "allowMutations", hasUI: true }),
    ).toBe("allow");
  });
});

describe("classifyTool", () => {
  it("maps catalog tools to risk classes", () => {
    expect(classifyTool("dagster_search_tools")).toBe("read");
    expect(classifyTool("dagster_launch_run")).toBe("remote_launch");
    // Catalog-level risk for the tool remains local_exec; per-args may elevate to local_source.
    expect(classifyTool("dagster_dg_command")).toBe("local_exec");
    expect(classifyTool("dagster_graphql_mutation")).toBe("remote_state");
    expect(classifyTool("unknown_tool")).toBe("read");
  });

  it("stubs are empty in Phase 3 (all mutation tools real)", () => {
    expect(LAZY_STUB_NAMES).not.toContain("dagster_dg_command");
    expect(LAZY_STUB_NAMES).not.toContain("dagster_launch_run");
    expect(LAZY_STUB_NAMES).toHaveLength(0);
  });
});

describe("classifyDgArgs + readOnly", () => {
  it("scaffold args are local_source and blocked under readOnly", () => {
    expect(classifyDgArgs(["scaffold", "defs", "x"])).toBe("local_source");
    expect(
      assertAllowed({
        risk: classifyDgArgs(["scaffold", "defs", "x"]),
        policy: "readOnly",
        hasUI: true,
      }),
    ).toBe("block");
  });

  it("readOnly blocks local_exec check", () => {
    expect(
      assertAllowed({
        risk: classifyDgArgs(["check", "defs"]),
        policy: "readOnly",
        hasUI: false,
        force: true,
      }),
    ).toBe("block");
  });
});
