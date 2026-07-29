import assert from "node:assert/strict";
import { mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import { GraphManager, assertSupportedNodeVersion } from "../extensions/graph-manager.ts";
import { FakeGraph, fakeApi } from "./helpers.ts";

function root(): string {
	return realpathSync(mkdtempSync(path.join(tmpdir(), "pi-codegraph-manager-")));
}

describe("GraphManager direct lifecycle", () => {
	it("constructor performs no SDK load and simultaneous starts share one open", async () => {
		const project = root();
		const graph = new FakeGraph();
		const api = fakeApi(graph);
		let loads = 0;
		const manager = new GraphManager({ loadApi: () => { loads += 1; return api; }, nodeVersion: "24.1.0" });
		try {
			assert.equal(loads, 0);
			const [left, right, third] = await Promise.all([
				manager.start(project, { allowCreate: true }),
				manager.start(project, { allowCreate: true }),
				manager.start(project, { allowCreate: true }),
			]);
			assert.equal(left, graph);
			assert.equal(right, graph);
			assert.equal(third, graph);
			assert.equal(loads, 1);
			assert.equal(api.opens, 1);
			assert.equal(graph.syncCalls, 1);
			assert.equal(manager.snapshot().kind, "ready");
		} finally {
			await manager.shutdown();
			rmSync(project, { recursive: true, force: true });
		}
	});

	it("initializes a missing graph and full-reindexes an existing graph with official methods", async () => {
		const missingRoot = root();
		const missingGraph = new FakeGraph();
		const missingApi = fakeApi(missingGraph, false);
		const missing = new GraphManager({ loadApi: () => missingApi, nodeVersion: "22.5.0" });
		try {
			await missing.start(missingRoot, { allowCreate: true });
			assert.equal(missingApi.inits, 1);
			assert.equal(missingGraph.indexCalls, 1);
		} finally {
			await missing.shutdown();
			rmSync(missingRoot, { recursive: true, force: true });
		}

		const existingRoot = root();
		const existingGraph = new FakeGraph();
		const existingApi = fakeApi(existingGraph, true);
		const existing = new GraphManager({ loadApi: () => existingApi, nodeVersion: "24.9.0" });
		try {
			await existing.start(existingRoot, { allowCreate: true, forceReindex: true });
			assert.equal(existingApi.recreates, 1);
			assert.equal(existingGraph.indexCalls, 1);
		} finally {
			await existing.shutdown();
			rmSync(existingRoot, { recursive: true, force: true });
		}
	});

	it("reports a missing graph without creating it when creation is not allowed", async () => {
		const project = root();
		const graph = new FakeGraph();
		const api = fakeApi(graph, false);
		const manager = new GraphManager({ loadApi: () => api, nodeVersion: "24.1.0" });
		try {
			await assert.rejects(() => manager.start(project, { allowCreate: false }), /Run \/codegraph init/u);
			assert.equal(api.inits, 0);
			assert.equal(graph.indexCalls, 0);
			assert.equal(manager.snapshot().kind, "missing");
		} finally {
			await manager.shutdown();
			rmSync(project, { recursive: true, force: true });
		}
	});

	it("marks stale synchronously, coalesces paths, and runs a second sync for edits during sync", async () => {
		const project = root();
		const graph = new FakeGraph();
		const manager = new GraphManager({ loadApi: () => fakeApi(graph), nodeVersion: "24.1.0", profile: true });
		let mutationSyncs = 0;
		let release!: () => void;
		let started!: () => void;
		const startedPromise = new Promise<void>((resolve) => { started = resolve; });
		try {
			await manager.start(project, { allowCreate: true });
			graph.onSync = async () => {
				mutationSyncs += 1;
				if (mutationSyncs === 1) {
					started();
					await new Promise<void>((resolve) => { release = resolve; });
				}
			};
			assert.equal(manager.invalidate(project, ["src/a.ts"], "edit-1"), true);
			assert.equal(manager.snapshot().kind, "stale");
			await startedPromise;
			assert.equal(manager.invalidate(project, ["src/b.ts"], "edit-2"), true);
			assert.equal(manager.snapshot().fresh, false);
			release();
			await manager.whenIdle();
			assert.equal(mutationSyncs, 2);
			assert.equal(manager.snapshot().kind, "ready");
			assert.equal(manager.snapshot().fresh, true);
			assert.equal(manager.profileReport().operations["mutation.to_fresh"]?.count, 1);
		} finally {
			await manager.shutdown();
			rmSync(project, { recursive: true, force: true });
		}
	});

	it("does not restart the watcher or claim freshness after a lock-blocked sync", async () => {
		const project = root();
		const graph = new FakeGraph();
		const manager = new GraphManager({ loadApi: () => fakeApi(graph), nodeVersion: "24.1.0" });
		try {
			await manager.start(project, { allowCreate: true });
			graph.syncUnavailable = true;
			assert.equal(manager.invalidate(project, ["src/a.ts"], "edit-locked"), true);
			await manager.whenIdle();
			assert.equal(manager.snapshot().kind, "failed");
			assert.equal(manager.snapshot().fresh, false);
			assert.match(manager.snapshot().message ?? "", /file lock unavailable/u);
			assert.equal(graph.watching, false);
			assert.equal(graph.watchCalls, 1);

			graph.syncUnavailable = false;
			assert.equal(manager.invalidate(project, ["src/a.ts"], "edit-retry"), true);
			await manager.whenIdle();
			assert.equal(manager.snapshot().kind, "ready");
			assert.equal(manager.snapshot().fresh, true);
			assert.equal(graph.watchCalls, 2);
		} finally {
			await manager.shutdown();
			rmSync(project, { recursive: true, force: true });
		}
	});

	it("rejects unsupported hosts clearly and closes/unwatches idempotently", async () => {
		assert.throws(() => assertSupportedNodeVersion("22.4.9"), />=22\.5 <25/u);
		assert.throws(() => assertSupportedNodeVersion("25.0.0"), />=22\.5 <25/u);
		assert.doesNotThrow(() => assertSupportedNodeVersion("24.99.0"));
		const project = root();
		const graph = new FakeGraph();
		const manager = new GraphManager({ loadApi: () => fakeApi(graph), nodeVersion: "25.0.0" });
		try {
			await assert.rejects(() => manager.start(project, { allowCreate: true }), /requires Node\.js >=22\.5 <25/u);
		} finally {
			await manager.shutdown();
			await manager.shutdown();
			assert.equal(graph.closed, 0);
			rmSync(project, { recursive: true, force: true });
		}
	});

	it("root replacement closes the previous graph exactly once", async () => {
		const firstRoot = root();
		const secondRoot = root();
		const first = new FakeGraph();
		const second = new FakeGraph();
		const api = {
			CodeGraph: {
				isInitialized: () => true,
				open: async (projectRoot: string) => projectRoot === firstRoot ? first : second,
				init: async () => first,
				recreate: async () => first,
			},
		};
		const manager = new GraphManager({ loadApi: () => api, nodeVersion: "24.1.0" });
		try {
			await manager.start(firstRoot, { allowCreate: true });
			await manager.start(secondRoot, { allowCreate: true });
			assert.equal(first.unwatched, 1);
			assert.equal(first.closed, 1);
			assert.equal(second.closed, 0);
		} finally {
			await manager.shutdown();
			rmSync(firstRoot, { recursive: true, force: true });
			rmSync(secondRoot, { recursive: true, force: true });
		}
	});

	it("shutdown unwatches and closes an opened graph exactly once", async () => {
		const project = root();
		const graph = new FakeGraph();
		const manager = new GraphManager({ loadApi: () => fakeApi(graph), nodeVersion: "24.0.0" });
		try {
			await manager.start(project, { allowCreate: true });
			await manager.shutdown();
			await manager.shutdown();
			assert.equal(graph.unwatched, 1);
			assert.equal(graph.closed, 1);
		} finally {
			rmSync(project, { recursive: true, force: true });
		}
	});
});
