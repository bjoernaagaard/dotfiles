import assert from "node:assert/strict";
import { mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import { parseFilesMutatedEvent } from "../extensions/mutation-sync.ts";
import { formatStatus } from "../extensions/status.ts";
import { OperationProfiler } from "../extensions/profiler.ts";
import type { GraphSnapshot } from "../extensions/types.ts";

describe("mutation event contract", () => {
	it("accepts legacy and conservative root invalidation payloads", () => {
		const lexicalRoot = mkdtempSync(path.join(tmpdir(), "pi-codegraph-event-"));
		const root = realpathSync(lexicalRoot);
		try {
			const legacy = {
				schemaVersion: 1,
				source: "pi-ast-grep",
				projectRoot: root,
				transactionId: `transaction-${"a".repeat(24)}`,
				operation: "apply",
				state: "applied",
				paths: ["src/a.ts"],
				canonicalPaths: [path.join(root, "src/a.ts")],
				emittedAt: "2026-01-01T00:00:00.000Z",
			};
			assert.deepEqual(parseFilesMutatedEvent(legacy), legacy);
			const symlinkNormalized = parseFilesMutatedEvent({
				...legacy,
				projectRoot: lexicalRoot,
				canonicalPaths: [path.join(lexicalRoot, "src/a.ts")],
			});
			assert.equal(symlinkNormalized.projectRoot, root);
			assert.deepEqual(symlinkNormalized.canonicalPaths, [path.join(root, "src/a.ts")]);
			const conservative = parseFilesMutatedEvent({
				schemaVersion: 1,
				source: "shared-mutation-tool",
				projectRoot: root,
				paths: [],
				emittedAt: "2026-01-01T00:00:00.000Z",
			});
			assert.deepEqual(conservative.paths, []);
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});

	it("rejects unsorted, duplicate, and escaping paths", () => {
		const root = realpathSync(mkdtempSync(path.join(tmpdir(), "pi-codegraph-event-bad-")));
		const base = { schemaVersion: 1, source: "x", projectRoot: root, emittedAt: "2026-01-01T00:00:00.000Z" };
		try {
			assert.throws(() => parseFilesMutatedEvent({ ...base, paths: ["z.ts", "a.ts"] }), /sorted/u);
			assert.throws(() => parseFilesMutatedEvent({ ...base, paths: ["a.ts", "a.ts"] }), /unique/u);
			assert.throws(() => parseFilesMutatedEvent({ ...base, paths: ["../outside.ts"] }), /inside/u);
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});
});

describe("composable status and profiling", () => {
	const snapshot: GraphSnapshot = {
		kind: "ready",
		projectRoot: "/project",
		fresh: true,
		pendingPaths: [],
		watching: true,
		watcherDegraded: false,
		stats: { nodeCount: 42, edgeCount: 30, fileCount: 7, nodesByKind: {} as any, edgesByKind: {} as any, filesByLanguage: {} as any, dbSizeBytes: 1, lastUpdated: 1 },
		lastDurationMs: 4.25,
		profileEnabled: false,
	};

	it("renders compact powerline and ASCII-safe variants", () => {
		assert.match(formatStatus(snapshot, false) ?? "", /CG ◆.*7f\/42n.*fresh.*4\.3ms/u);
		assert.equal(formatStatus(snapshot, true), "CG | ready | 7f/42n | fresh | watch | 4.3ms");
		assert.equal(formatStatus({ ...snapshot, kind: "closed" }, false), undefined);
	});

	it("profiling disabled adds no aggregates; enabled records successful and failed operations", async () => {
		const profiler = new OperationProfiler(false);
		await profiler.measure("query", async () => "ok");
		assert.deepEqual(profiler.report().operations, {});
		profiler.setEnabled(true);
		await profiler.measure("query", async () => "ok", (value) => value.length);
		let sizedFailedOutput = false;
		await assert.rejects(
			profiler.measure<string>("query", async () => { throw new Error("query failed"); }, (value) => {
				sizedFailedOutput = true;
				return value.length;
			}),
			/query failed/u,
		);
		assert.equal(sizedFailedOutput, false);
		const report = profiler.report();
		assert.equal(report.operations.query?.count, 2);
		assert.equal(report.operations.query?.failures, 1);
		assert.equal(report.operations.query?.outputBytes, 2);
		profiler.setEnabled(false);
		assert.deepEqual(profiler.report().operations, {});
	});
});
