import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { it } from "node:test";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { registerCodegraphCommand } from "../extensions/command.ts";
import type { GraphManager } from "../extensions/graph-manager.ts";

it("offers choice-based TUI commands and routes init/sync/profile directly to the manager", async () => {
	let handler: ((args: string, ctx: any) => Promise<void>) | undefined;
	const calls: string[] = [];
	let profiling = false;
	const manager = {
		profileReport: () => ({ enabled: profiling, operations: {} }),
		setProfiling: (enabled: boolean) => { profiling = enabled; calls.push(`profile:${enabled}`); },
		start: async (_root: string, options: any) => { calls.push(options.forceReindex ? "reindex" : "start"); },
		sync: async () => { calls.push("sync"); },
		snapshot: () => ({ kind: "ready", projectRoot: "/x", fresh: true, pendingPaths: [], watching: true, watcherDegraded: false, profileEnabled: profiling }),
	} as unknown as GraphManager;
	const pi = {
		registerCommand(_name: string, definition: any) { handler = definition.handler; },
	} as ExtensionAPI;
	registerCodegraphCommand(pi, manager, () => true);
	assert.ok(handler);

	const root = mkdtempSync(path.join(tmpdir(), "pi-codegraph-command-"));
	const notifications: string[] = [];
	try {
		const ctx = {
			cwd: root,
			mode: "tui",
			hasUI: true,
			isProjectTrusted: () => true,
			ui: {
				select: async () => "sync — incrementally refresh",
				notify: (message: string) => notifications.push(message),
			},
		};
		await handler!("", ctx);
		assert.deepEqual(calls, ["start", "sync"]);
		await handler!("init", ctx);
		assert.ok(calls.includes("reindex"));
		await handler!("profile-on", ctx);
		assert.equal(profiling, true);
		assert.ok(notifications.some((message) => message.includes("profiling enabled")));
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});
