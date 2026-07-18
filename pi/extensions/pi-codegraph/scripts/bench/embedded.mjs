#!/usr/bin/env node
import { createRequire } from "node:module";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { performance } from "node:perf_hooks";

const require = createRequire(import.meta.url);
const { CodeGraph } = require("@colbymchenry/codegraph");
const packageVersion = require("@colbymchenry/codegraph/package.json").version;
const root = mkdtempSync(path.join(tmpdir(), "pi-codegraph-bench-"));
let graph;

function timed(operation) {
	const started = performance.now();
	return Promise.resolve(operation()).then((value) => ({ value, ms: performance.now() - started }));
}
function median(values) {
	const sorted = [...values].sort((a, b) => a - b);
	return sorted[Math.floor(sorted.length / 2)] ?? 0;
}
function p95(values) {
	const sorted = [...values].sort((a, b) => a - b);
	return sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * 0.95) - 1)] ?? 0;
}
function summary(samples) {
	return { samples: samples.length, medianMs: median(samples), p95Ms: p95(samples), rawMs: samples };
}

try {
	mkdirSync(path.join(root, "src"), { recursive: true });
	writeFileSync(path.join(root, "package.json"), JSON.stringify({ name: "embedded-bench", type: "module" }));
	for (let file = 0; file < 20; file += 1) {
		const functions = [];
		for (let index = 0; index < 10; index += 1) {
			functions.push(`export function fn${file}_${index}(value: number): number { return value + ${index}; }`);
		}
		writeFileSync(path.join(root, "src", `module-${file}.ts`), functions.join("\n"));
	}
	writeFileSync(path.join(root, "src", "entry.ts"), "import { fn0_0 } from './module-0.js';\nexport function entry(value: number) { return fn0_0(value); }\n");

	const rssBefore = process.memoryUsage().rss;
	const cold = await timed(async () => {
		const instance = await CodeGraph.init(root, { index: false });
		await instance.indexAll();
		return instance;
	});
	graph = cold.value;
	const rssAfterCold = process.memoryUsage().rss;
	graph.close();
	graph = undefined;

	const warm = await timed(() => CodeGraph.open(root, { sync: false, readOnly: false }));
	graph = warm.value;
	const target = graph.searchNodes("fn0_0", { limit: 1 })[0]?.node;
	if (!target) throw new Error("benchmark target missing");

	// Warm each official query surface before measurement.
	graph.searchNodes("fn0_0", { limit: 20 });
	await graph.buildContext("trace entry to fn0_0", { format: "json", includeCode: true, maxNodes: 30 });
	graph.getCallers(target.id, 3);
	graph.getCallees(target.id, 3);
	graph.getImpactRadius(target.id, 3);

	const searchSamples = [];
	const exploreSamples = [];
	const broaderSamples = [];
	for (let index = 0; index < 21; index += 1) {
		searchSamples.push((await timed(() => graph.searchNodes("fn0_0", { limit: 20 }))).ms);
		exploreSamples.push((await timed(() => graph.buildContext("trace entry to fn0_0", { format: "json", includeCode: true, maxNodes: 30 }))).ms);
		broaderSamples.push((await timed(() => {
			const matches = graph.searchNodes("fn0_0", { limit: 20 });
			graph.getCallers(target.id, 3);
			graph.getCallees(target.id, 3);
			graph.getImpactRadius(target.id, 3);
			return matches;
		})).ms);
	}

	const mutationSamples = [];
	for (let index = 0; index < 7; index += 1) {
		writeFileSync(path.join(root, "src", "entry.ts"), `import { fn0_0 } from './module-0.js';\nexport function entry(value: number) { return fn0_0(value) + ${index}; }\n`);
		mutationSamples.push((await timed(() => graph.sync())).ms);
	}

	console.log(JSON.stringify({
		codegraphVersion: packageVersion,
		node: process.version,
		platform: `${process.platform}-${process.arch}`,
		fixture: { files: 21, symbols: 201 },
		startup: { coldInitAndIndexMs: cold.ms, warmOpenMs: warm.ms, rssDeltaBytes: rssAfterCold - rssBefore },
		queries: {
			searchNodes: summary(searchSamples),
			exploreBuildContextOnly: summary(exploreSamples),
			broaderSearchCallersCalleesImpact: summary(broaderSamples),
		},
		mutationToFresh: { method: "CodeGraph.sync", ...summary(mutationSamples) },
		officialMethods: ["CodeGraph.init", "indexAll", "CodeGraph.open", "searchNodes", "buildContext", "getCallers", "getCallees", "getImpactRadius", "sync", "close"],
	}, null, 2));
} finally {
	graph?.unwatch();
	graph?.close();
	rmSync(root, { recursive: true, force: true });
}
