import { describe, expect, test } from "vitest";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import extension from "../index.ts";

function createApiRecorder() {
	const handlers = new Map<string, (...args: unknown[]) => unknown>();
	const tools: Array<Record<string, unknown>> = [];
	const api = {
		registerTool: (tool: Record<string, unknown>) => tools.push(tool),
		registerCommand: () => {},
		getActiveTools: () => [],
		setActiveTools: () => {},
		on: (event: string, handler: (...args: unknown[]) => unknown) => {
			handlers.set(event, handler);
		},
	} as unknown as ExtensionAPI;
	return { api, handlers, tools };
}

describe("QuestDB tool-native guidance", () => {
	test("does not register a skill resource handler", () => {
		const { api, handlers } = createApiRecorder();
		extension(api);
		expect(handlers.has(["resources", "discover"].join("_"))).toBe(false);
	});

	test("keeps safe native workflow guidance on the hub", () => {
		const { api, tools } = createApiRecorder();
		extension(api);
		const hub = tools.find((tool) => tool.name === "questdb");
		expect(hub?.promptGuidelines).toEqual(expect.arrayContaining([
			expect.stringContaining("query-before-exec"),
			expect.stringContaining("SAMPLE BY"),
		]));
		expect(hub?.description).toContain("read-only");
		expect(tools.find((tool) => tool.name === "questdb_query")?.description).toContain("not PostgreSQL");
		expect(tools.find((tool) => tool.name === "questdb_schema")?.description).toContain("designated TIMESTAMP");
		expect(tools.find((tool) => tool.name === "questdb_docs")?.description).toContain("official QuestDB");
	});

	test("retains conditional guidance without activating specialists", async () => {
		const { api, handlers } = createApiRecorder();
		extension(api);
		const beforeStart = handlers.get("before_agent_start");
		expect(beforeStart).toBeTypeOf("function");
		const result = await beforeStart?.({ prompt: "Use QuestDB SQL", systemPrompt: "base" });
		expect(result).toMatchObject({ systemPrompt: expect.stringContaining("QuestDB context detected") });
	});

	test("guidance contains no configuration or secret values", async () => {
		const { api, tools } = createApiRecorder();
		extension(api);
		const hub = tools.find((tool) => tool.name === "questdb");
		const text = JSON.stringify(hub?.promptGuidelines) + JSON.stringify(hub?.description);
		expect(text).not.toMatch(/authToken|basicPassword|QUESTDB_(TOKEN|PASSWORD)|runConfig/i);
	});
});
