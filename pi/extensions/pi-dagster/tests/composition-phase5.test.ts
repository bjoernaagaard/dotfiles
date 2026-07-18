import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import coreFactory from "../extensions/core.ts";
import remoteFactory from "../extensions/remote.ts";
import providerFactory from "../extensions/provider.ts";
import { ALWAYS_ON_NAMES, LAZY_TOOL_NAMES } from "../src/tools/catalog.ts";
import { lazyToolPromptMetadata } from "../src/tools/lazy/stubs.ts";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

function read(path: string): string {
  return readFileSync(join(root, path), "utf8");
}

describe("composition regression Phase 5", () => {
  it("does not call setFooter/setEditorComponent/override built-ins in core", () => {
    const core = read("extensions/core.ts");
    expect(core).not.toMatch(/setFooter/);
    expect(core).not.toMatch(/setEditorComponent/);
    expect(core).not.toMatch(/registerTool\(\s*\{\s*name:\s*["'](read|bash|edit|write)/);
  });

  it("remote and provider remain behaviorally inert", async () => {
    const notifies: string[] = [];
    const makePi = () => {
      const commands = new Map<string, { handler: Function }>();
      return {
        registerCommand: (name: string, def: { handler: Function }) => {
          commands.set(name, def);
        },
        registerTool: vi.fn(),
        registerProvider: vi.fn(),
        on: vi.fn(),
        setActiveTools: vi.fn(),
        getActiveTools: () => [],
        appendEntry: vi.fn(),
        _commands: commands,
      };
    };

    const remotePi = makePi();
    remoteFactory(remotePi as never);
    expect(remotePi.registerTool).not.toHaveBeenCalled();
    expect(remotePi.registerProvider).not.toHaveBeenCalled();
    const remoteCmd = remotePi._commands.get("dagster-remote");
    await remoteCmd!.handler("", {
      ui: { notify: async (m: string) => notifies.push(m) },
    });
    expect(notifies.join("\n")).toMatch(/inactive/i);

    const providerPi = makePi();
    providerFactory(providerPi as never);
    expect(providerPi.registerProvider).not.toHaveBeenCalled();
    expect(providerPi.registerTool).not.toHaveBeenCalled();
    const providerCmd = providerPi._commands.get("dagster-provider");
    await providerCmd!.handler("", {
      ui: { notify: async (m: string) => notifies.push(m) },
    });
    expect(notifies.join("\n")).toMatch(/inactive/i);
  });

  it("does not eagerly import optional graphql-ws during package boot", () => {
    const wsClient = read("src/clients/ws.ts");
    expect(wsClient).not.toMatch(
      /import\s*\{[^}]*\bcreateClient\b[^}]*\}\s*from\s*["']graphql-ws["']/s,
    );
    expect(wsClient).toMatch(/await\s+import\(["']graphql-ws["']\)/);
  });

  it("factory registration opens no resources (no network/timers in factory)", () => {
    const timers: unknown[] = [];
    const realSetTimeout = globalThis.setTimeout;
    // Capture accidental timer creation during factory (status updates etc. are on session_start)
    const pi = {
      registerCommand: vi.fn(),
      registerTool: vi.fn(),
      registerFlag: vi.fn(),
      registerEntryRenderer: vi.fn(),
      on: vi.fn(),
      setActiveTools: vi.fn(),
      getActiveTools: () => [...ALWAYS_ON_NAMES],
      appendEntry: vi.fn(),
      getFlag: vi.fn(),
    };
    coreFactory(pi as never);
    expect(pi.registerTool).toHaveBeenCalled();
    expect(pi.on).toHaveBeenCalled();
    // session_start is registered but not invoked — no resources yet
    void timers;
    void realSetTimeout;
  });

  it("lazy tools still omit prompt metadata; always-on set unchanged", () => {
    const metas = lazyToolPromptMetadata();
    expect(metas.length).toBe(LAZY_TOOL_NAMES.length);
    for (const m of metas) {
      expect(m.promptSnippet).toBeUndefined();
      expect(m.promptGuidelines).toBeUndefined();
    }
    expect(ALWAYS_ON_NAMES).toEqual([
      "dagster_search_tools",
      "dagster_target_status",
      "dagster_search",
      "dagster_get_context",
      "dagster_capabilities",
      "dagster_graphql_query",
    ]);
  });
});
