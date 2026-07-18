import type { ExtensionAPI, ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import type { GraphManager } from "./graph-manager.ts";
import { canonicalRoot } from "./paths.ts";
import { formatStatusReport } from "./status.ts";

const COMMANDS = ["status", "init", "sync", "profile-report", "profile-on", "profile-off"] as const;
type Command = (typeof COMMANDS)[number];

export function registerCodegraphCommand(pi: ExtensionAPI, manager: GraphManager, allowCreate: () => boolean): void {
	pi.registerCommand("codegraph", {
		description: "Embedded CodeGraph status, initialization, sync, and profiling",
		getArgumentCompletions(prefix) {
			const values = COMMANDS.filter((value) => value.startsWith(prefix));
			return values.length ? values.map((value) => ({ value, label: value })) : null;
		},
		async handler(args, ctx) {
			let command = args.trim() as Command | "";
			if (command === "" && ctx.mode === "tui") {
				const choice = await ctx.ui.select("CodeGraph", [
					"status — readiness and counts",
					"sync — incrementally refresh",
					"init — create or full reindex",
					"profile-report — local timing aggregates",
					manager.profileReport().enabled ? "profile-off — disable profiling" : "profile-on — enable profiling",
				]);
				if (!choice) return;
				command = choice.split(" ", 1)[0] as Command;
			}
			if (command === "") command = "status";
			if (!COMMANDS.includes(command as Command)) {
				notify(ctx, `Unknown CodeGraph command: ${command}`, "error");
				return;
			}
			if (!ctx.isProjectTrusted()) {
				notify(ctx, "CodeGraph requires a trusted project.", "error");
				return;
			}
			const root = canonicalRoot(ctx.cwd);

			if (command === "profile-on" || command === "profile-off") {
				manager.setProfiling(command === "profile-on");
				notify(ctx, `CodeGraph profiling ${command === "profile-on" ? "enabled" : "disabled"}.`, "info");
				return;
			}
			if (command === "profile-report") {
				notify(ctx, JSON.stringify(manager.profileReport(), null, 2), "info");
				return;
			}
			if (command === "init") {
				notify(ctx, "CodeGraph full reindex started…", "info");
				await manager.start(root, { allowCreate: true, forceReindex: true, signal: ctx.signal });
				notify(ctx, `CodeGraph initialized.\n${formatStatusReport(manager.snapshot())}`, "info");
				return;
			}
			if (command === "sync") {
				await manager.start(root, { allowCreate: false, signal: ctx.signal });
				await manager.sync(root, ctx.signal);
				notify(ctx, `CodeGraph synchronized.\n${formatStatusReport(manager.snapshot())}`, "info");
				return;
			}

			try {
				await manager.start(root, { allowCreate: allowCreate(), signal: ctx.signal });
			} catch (error) {
				if (manager.snapshot().kind !== "missing") throw error;
			}
			notify(ctx, formatStatusReport(manager.snapshot()), "info");
		},
	});
}

function notify(ctx: ExtensionCommandContext, message: string, level: "info" | "warning" | "error"): void {
	if (ctx.hasUI) ctx.ui.notify(message, level);
}
