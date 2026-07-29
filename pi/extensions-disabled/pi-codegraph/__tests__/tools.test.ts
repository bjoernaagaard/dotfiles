import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { GraphManager } from "../extensions/graph-manager.ts";
import { ToolRegistrar } from "../extensions/tools.ts";
import { OWNED_TOOL_NAMES } from "../extensions/types.ts";
import { FakeGraph, fakeApi, node } from "./helpers.ts";

function harness() {
	const definitions = new Map<string, any>();
	let active = ["read", "bash", "codegraph_foreign"];
	const pi = {
		registerTool(definition: any) { definitions.set(definition.name, definition); },
		getActiveTools() { return [...active]; },
		setActiveTools(names: string[]) { active = [...names]; },
	};
	return { pi: pi as ExtensionAPI, definitions, active: () => active };
}

function context(root: string, trusted = true, confirm?: () => Promise<boolean>) {
	return {
		cwd: root,
		isProjectTrusted: () => trusted,
		hasUI: confirm !== undefined,
		ui: { confirm },
	} as any;
}

describe("fixed native tool catalog", () => {
	it("registers the MCP-equivalent native schemas and activation preserves unrelated tools", async () => {
		const graph = new FakeGraph();
		const manager = new GraphManager({ loadApi: () => fakeApi(graph), nodeVersion: "24.1.0" });
		const value = harness();
		const registrar = new ToolRegistrar(value.pi, manager, () => true);
		registrar.registerAll();
		assert.deepEqual([...value.definitions.keys()], [...OWNED_TOOL_NAMES]);
		for (const definition of value.definitions.values()) {
			assert.equal(definition.parameters.additionalProperties, false);
		}
		registrar.setReady(true);
		assert.ok(value.active().includes("codegraph_foreign"));
		assert.ok(OWNED_TOOL_NAMES.every((name) => value.active().includes(name)));
		registrar.setReady(false);
		assert.ok(value.active().includes("codegraph_foreign"));
		assert.ok(OWNED_TOOL_NAMES.every((name) => !value.active().includes(name)));
		await manager.shutdown();
	});

	it("provides compact file, symbol, and status primitives", async () => {
		const root = mkdtempSync(path.join(tmpdir(), "pi-codegraph-native-parity-"));
		mkdirSync(path.join(root, "src"));
		writeFileSync(path.join(root, "src", "a.ts"), "export function greet() {\n\treturn true;\n}\n");
		const graph = new FakeGraph();
		const manager = new GraphManager({ loadApi: () => fakeApi(graph), nodeVersion: "24.1.0" });
		const value = harness();
		new ToolRegistrar(value.pi, manager, () => true).registerAll();
		try {
			const ctx = context(root);
			const file = await value.definitions.get("codegraph_node").execute("id", { filePath: "src/a.ts" }, undefined, undefined, ctx);
			const filePayload = JSON.parse(file.content[0].text);
			assert.equal(filePayload.mode, "file");
			assert.match(filePayload.source, /1\texport function greet/u);
			assert.equal(filePayload.symbols[0].name, "greet");

			const symbol = await value.definitions.get("codegraph_node").execute("id", { symbol: "greet", includeCode: true }, undefined, undefined, ctx);
			const symbolPayload = JSON.parse(symbol.content[0].text);
			assert.equal(symbolPayload.status, "resolved");
			assert.equal(symbolPayload.callers[0].edge.metadata.synthesizedBy, "callback");

			const files = await value.definitions.get("codegraph_files").execute("id", { format: "flat" }, undefined, undefined, ctx);
			const filesPayload = JSON.parse(files.content[0].text);
			assert.deepEqual(filesPayload.files.map((item: any) => item.path), ["src/a.ts", "src/b.ts"]);

			const status = await value.definitions.get("codegraph_status").execute("id", {}, undefined, undefined, ctx);
			assert.match(status.content[0].text, /freshness/u);
		} finally {
			await manager.shutdown();
			rmSync(root, { recursive: true, force: true });
		}
	});

	it("runs context/search in non-UI contexts with bounded structured output", async () => {
		const root = mkdtempSync(path.join(tmpdir(), "pi-codegraph-tools-"));
		const graph = new FakeGraph();
		const manager = new GraphManager({ loadApi: () => fakeApi(graph), nodeVersion: "24.1.0" });
		const value = harness();
		new ToolRegistrar(value.pi, manager, () => true).registerAll();
		try {
			const ctx = context(root);
			const result = await value.definitions.get("codegraph_context").execute("id", { query: "greet flow" }, undefined, undefined, ctx);
			assert.match(result.content[0].text, /static-analysis evidence/u);
			assert.equal(result.details.projectRoot, realpathSync(root));
			const search = await value.definitions.get("codegraph_search").execute("id", { query: "greet", limit: 2 }, undefined, undefined, ctx);
			assert.match(search.content[0].text, /"name": "greet"/u);
			assert.equal(search.details.truncated, false);
		} finally {
			await manager.shutdown();
			rmSync(root, { recursive: true, force: true });
		}
	});

	it("asks before creating a missing index on the first tool call", async () => {
		const root = mkdtempSync(path.join(tmpdir(), "pi-codegraph-confirm-"));
		const graph = new FakeGraph();
		const api = fakeApi(graph, false);
		const manager = new GraphManager({ loadApi: () => api, nodeVersion: "24.1.0" });
		const value = harness();
		new ToolRegistrar(value.pi, manager, () => false).registerAll();
		let prompts = 0;
		try {
			const search = value.definitions.get("codegraph_search");
			const result = await search.execute("id", { query: "greet" }, undefined, undefined, context(root, true, async () => {
				prompts += 1;
				return true;
			}));
			assert.match(result.content[0].text, /"name": "greet"/u);
			assert.equal(prompts, 1);
			assert.equal(api.inits, 1);
			assert.equal(graph.indexCalls, 1);
		} finally {
			await manager.shutdown();
			rmSync(root, { recursive: true, force: true });
		}
	});

	it("returns deterministic ambiguity candidates instead of guessing a caller target", async () => {
		const root = mkdtempSync(path.join(tmpdir(), "pi-codegraph-ambiguity-"));
		const graph = new FakeGraph();
		graph.nodes = [node("greet", "src/z.ts", 9), node("greet", "src/a.ts", 2), node("caller", "src/c.ts", 3)];
		const manager = new GraphManager({ loadApi: () => fakeApi(graph), nodeVersion: "24.1.0" });
		const value = harness();
		new ToolRegistrar(value.pi, manager, () => true).registerAll();
		try {
			const tool = value.definitions.get("codegraph_callers");
			const ambiguous = await tool.execute("id", { symbol: "greet" }, undefined, undefined, context(root));
			const parsed = JSON.parse(ambiguous.content[0].text);
			assert.equal(parsed.status, "ambiguous");
			assert.deepEqual(parsed.candidates.map((item: any) => item.filePath), ["src/a.ts", "src/z.ts"]);
			const resolved = await tool.execute("id", { symbol: "greet", filePath: "src/a.ts", includeSource: true }, undefined, undefined, context(root));
			assert.match(resolved.content[0].text, /tree-sitter/u);
			assert.match(resolved.content[0].text, /Call edges can omit dynamic dispatch/u);
		} finally {
			await manager.shutdown();
			rmSync(root, { recursive: true, force: true });
		}
	});

	it("confines projectPath, rejects untrusted calls, and blocks graph queries while stale", async () => {
		const parent = mkdtempSync(path.join(tmpdir(), "pi-codegraph-roots-"));
		const active = path.join(parent, "active");
		const foreign = path.join(parent, "foreign");
		const { mkdirSync } = await import("node:fs");
		mkdirSync(active);
		mkdirSync(foreign);
		const graph = new FakeGraph();
		const manager = new GraphManager({ loadApi: () => fakeApi(graph), nodeVersion: "24.1.0" });
		const value = harness();
		new ToolRegistrar(value.pi, manager, () => true).registerAll();
		try {
			const search = value.definitions.get("codegraph_search");
			await assert.rejects(() => search.execute("id", { query: "x", projectPath: foreign }, undefined, undefined, context(active)), /active project root/u);
			await assert.rejects(() => search.execute("id", { query: "x" }, undefined, undefined, context(active, false)), /trusted project/u);
			await manager.start(active, { allowCreate: true });
			let release!: () => void;
			graph.onSync = () => new Promise<void>((resolve) => { release = resolve; });
			manager.invalidate(active, ["src/a.ts"], "pending");
			await assert.rejects(() => search.execute("id", { query: "x" }, undefined, undefined, context(active)), /CodeGraph is stale|syncing/u);
			await new Promise<void>((resolve) => queueMicrotask(resolve));
			release();
			await manager.whenIdle();
		} finally {
			await manager.shutdown();
			rmSync(parent, { recursive: true, force: true });
		}
	});
});
