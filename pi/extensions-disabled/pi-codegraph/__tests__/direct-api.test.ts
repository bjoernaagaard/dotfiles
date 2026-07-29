import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { it } from "node:test";
import { GraphManager } from "../extensions/graph-manager.ts";

it("indexes, queries, syncs, watches, and closes through the official embedded API", { timeout: 30_000 }, async () => {
	const root = mkdtempSync(path.join(tmpdir(), "pi-codegraph-direct-"));
	mkdirSync(path.join(root, "src"), { recursive: true });
	writeFileSync(path.join(root, "package.json"), JSON.stringify({ name: "direct-fixture", type: "module" }));
	writeFileSync(path.join(root, "src", "flow.ts"), [
		"export function helper(value: string): string { return value.toUpperCase(); }",
		"export function greet(name: string): string { return helper(name); }",
		"export function entry(): string { return greet('world'); }",
	].join("\n"));

	const manager = new GraphManager({ profile: true, watchDebounceMs: 25 });
	try {
		await manager.start(root, { allowCreate: true });
		const stats = manager.snapshot().stats;
		assert.equal(stats?.fileCount, 1);
		assert.ok((stats?.nodeCount ?? 0) >= 3);
		assert.equal(manager.snapshot().watching, true);

		const search = await manager.query("search-test", undefined, (graph) => graph.searchNodes("greet", { limit: 5 }));
		assert.equal(search[0]?.node.name, "greet");
		const greet = search[0]!.node;
		const callers = await manager.query("callers-test", undefined, (graph) => graph.getCallers(greet.id, 2));
		assert.ok(callers.some((item) => item.node.name === "entry"));
		const context = await manager.query("context-test", undefined, (graph) => graph.buildContext("greet helper flow", { format: "json", includeCode: true, maxNodes: 10 }));
		assert.match(String(context), /greet/u);
		const impact = await manager.query("impact-test", undefined, (graph) => graph.getImpactRadius(greet.id, 3));
		assert.ok(impact.nodes.size >= 2);
		const indexedFiles = await manager.query("files-test", undefined, (graph) => graph.getFiles());
		assert.equal(indexedFiles.length, 1);
		assert.ok((await manager.query("file-nodes-test", undefined, (graph) => graph.getNodesInFile("src/flow.ts"))).length >= 3);

		writeFileSync(path.join(root, "src", "flow.ts"), [
			"export function helper(value: string): string { return `hello ${value}`; }",
			"export function greet(name: string): string { return helper(name); }",
			"export function entry(): string { return greet('world'); }",
		].join("\n"));
		assert.equal(manager.invalidate(root, ["src/flow.ts"], "test-edit"), true);
		assert.equal(manager.snapshot().fresh, false);
		await manager.whenIdle();
		assert.equal(manager.snapshot().fresh, true);
		assert.ok(manager.profileReport().operations["sync.mutation"]?.count);
	} finally {
		await manager.shutdown();
		rmSync(root, { recursive: true, force: true });
	}
});
