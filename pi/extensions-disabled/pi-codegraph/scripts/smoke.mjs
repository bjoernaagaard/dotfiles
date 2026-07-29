#!/usr/bin/env node
import { createRequire } from "node:module";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const require = createRequire(import.meta.url);
const { CodeGraph } = require("@colbymchenry/codegraph");
const fixture = mkdtempSync(path.join(tmpdir(), "pi-codegraph-smoke-"));
let graph;

try {
	mkdirSync(path.join(fixture, "src"), { recursive: true });
	writeFileSync(path.join(fixture, "package.json"), JSON.stringify({ name: "smoke", type: "module" }));
	writeFileSync(path.join(fixture, "src", "hello.ts"), [
		"export function greet(name: string): string { return helper(name); }",
		"export function helper(value: string): string { return `hello ${value}`; }",
		"export function entry(): string { return greet('world'); }",
	].join("\n"));

	graph = await CodeGraph.init(fixture, { index: false });
	const indexed = await graph.indexAll();
	if (!indexed.success) throw new Error("initial index failed");
	const stats = graph.getStats();
	const greet = graph.searchNodes("greet", { limit: 1 })[0]?.node;
	if (!greet) throw new Error("greet symbol not found");
	const context = await graph.buildContext("trace greet from entry", { format: "json", includeCode: true, maxNodes: 10 });
	const callers = graph.getCallers(greet.id, 2);
	const callees = graph.getCallees(greet.id, 2);
	const impact = graph.getImpactRadius(greet.id, 3);
	const watching = graph.watch({ debounceMs: 25 });
	await graph.waitUntilWatcherReady();
	graph.unwatch();

	writeFileSync(path.join(fixture, "src", "hello.ts"), [
		"export function greet(name: string): string { return helper(name); }",
		"export function helper(value: string): string { return `hi ${value}`; }",
		"export function entry(): string { return greet('world'); }",
	].join("\n"));
	const synced = await graph.sync();
	const watchingAfterSync = graph.watch({ debounceMs: 25 });
	await graph.waitUntilWatcherReady();
	if (graph.getStats().fileCount !== 1) throw new Error("unexpected file count after sync");

	console.log(JSON.stringify({
		ok: true,
		indexed,
		stats,
		contextBytes: Buffer.byteLength(String(context), "utf8"),
		callers: callers.length,
		callees: callees.length,
		impactNodes: impact.nodes.size,
		watching,
		watchingAfterSync,
		synced,
	}, null, 2));
} finally {
	graph?.unwatch();
	graph?.close();
	rmSync(fixture, { recursive: true, force: true });
}
