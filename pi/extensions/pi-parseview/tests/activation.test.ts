import { describe, expect, it } from "vite-plus/test";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { createActivationController } from "../src/tools/activation";

function recorder(options: { active?: string[]; externalCollision?: string } = {}) {
  let active = options.active ?? ["read", "other_extension_tool"];
  const transitions: string[][] = [];
  const names = [
    "parse_document",
    "query_document",
    "screenshot_document",
    "render_diagram",
    "preview_content",
    "mermaid",
  ];
  const all = names.map((name) => ({
    name,
    sourceInfo:
      name === options.externalCollision
        ? { source: "other-extension", path: "/tmp/other-extension/index.ts" }
        : { source: "@juvio15/pi-parseview", path: "/tmp/pi-parseview/index.ts" },
  }));
  const api = {
    getActiveTools: () => [...active],
    getAllTools: () => [...all],
    setActiveTools: (next: string[]) => {
      active = [
        ...new Set(
          next.filter(
            (name) =>
              all.some((tool) => tool.name === name) || name.startsWith("other") || name === "read",
          ),
        ),
      ];
      transitions.push([...active]);
    },
  } as unknown as ExtensionAPI;
  return { api, transitions, active: () => active };
}

describe("ParseView activation controller", () => {
  it("activates dependency closures additively without duplicate or unrelated-tool loss", () => {
    const state = recorder();
    const activation = createActivationController(state.api);
    activation.beginTurn(["screenshot_document", "screenshot_document", "unknown"]);

    expect(state.active()).toEqual([
      "read",
      "other_extension_tool",
      "parse_document",
      "query_document",
      "screenshot_document",
    ]);
    expect(state.transitions).toHaveLength(1);
  });

  it("avoids redundant transitions across repeated activation and usage in one turn", () => {
    const state = recorder();
    const activation = createActivationController(state.api);

    activation.beginTurn(["query_document"]);
    activation.activateAdditively(["query_document", "parse_document"]);
    activation.markUsed("query_document");
    activation.markUsed("query_document");
    expect(state.transitions).toHaveLength(1);

    activation.settle();
    expect(state.transitions).toHaveLength(2);
    activation.settle();
    expect(state.transitions).toHaveLength(2);
    expect(state.active()).toEqual(["read", "other_extension_tool"]);
  });

  it("releases owned turn tools only after settle", () => {
    const state = recorder();
    const activation = createActivationController(state.api);
    activation.beginTurn(["query_document"]);
    expect(state.active()).toContain("query_document");

    activation.settle();
    expect(state.active()).toEqual(["read", "other_extension_tool"]);
  });

  it("retains dependencies while an active dependent remains externally retained", () => {
    const state = recorder({ active: ["read", "query_document"] });
    const activation = createActivationController(state.api);
    activation.activateAdditively(["parse_document"]);
    activation.settle();

    expect(state.active()).toEqual(["read", "query_document", "parse_document"]);
  });

  it("keeps plain-text parse/query available while gating native screenshots", () => {
    const state = recorder();
    const activation = createActivationController(state.api);
    activation.setParserAvailable(false);

    expect(activation.beginTurn(["parse_document", "query_document"])).toEqual([
      "parse_document",
      "query_document",
    ]);
    expect(activation.beginTurn(["screenshot_document"])).toEqual([]);
    expect(state.active()).toEqual([
      "read",
      "other_extension_tool",
      "parse_document",
      "query_document",
    ]);
    expect(activation.beginTurn(["render_diagram"])).toEqual(["render_diagram"]);
  });

  it("session reset removes only owned definitions and preserves name collisions", () => {
    const state = recorder({
      active: ["read", "render_diagram", "query_document", "other_extension_tool"],
      externalCollision: "query_document",
    });
    const activation = createActivationController(state.api);
    activation.resetForSession();

    expect(state.active()).toEqual(["read", "query_document", "other_extension_tool"]);
  });
});
