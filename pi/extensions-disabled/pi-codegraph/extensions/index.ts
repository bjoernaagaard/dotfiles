import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { registerCodegraphCommand } from "./command.ts";
import { GraphManager } from "./graph-manager.ts";
import { FILES_MUTATED_EVENT, mutationId, parseFilesMutatedEvent } from "./mutation-sync.ts";
import { canonicalRoot } from "./paths.ts";
import { formatStatus } from "./status.ts";
import { ToolRegistrar } from "./tools.ts";
import {
	DEFAULT_AUTO_INDEX,
	FLAG_ASCII_STATUS,
	FLAG_AUTO_INDEX,
	FLAG_PROFILE,
	STATUS_KEY,
	type AbsPath,
} from "./types.ts";

/** Factory registration is deliberately resource-free; the SDK is loaded only by GraphManager.start(). */
export default function codegraphExtension(pi: ExtensionAPI): void {
	let activeContext: ExtensionContext | undefined;
	let activeRoot: AbsPath | undefined;
	let registrar: ToolRegistrar;
	let disposed = false;

	const manager = new GraphManager({
		onStateChange(snapshot) {
			if (disposed || !activeContext || snapshot.projectRoot !== activeRoot) return;
			if (activeContext.hasUI) {
				activeContext.ui.setStatus(STATUS_KEY, formatStatus(snapshot, Boolean(pi.getFlag(FLAG_ASCII_STATUS))));
			}
		},
	});
	registrar = new ToolRegistrar(pi, manager, () => Boolean(pi.getFlag(FLAG_AUTO_INDEX)));

	pi.registerFlag(FLAG_AUTO_INDEX, {
		type: "boolean",
		default: DEFAULT_AUTO_INDEX,
		description: "Automatically create a missing embedded CodeGraph index after session start",
	});
	pi.registerFlag(FLAG_PROFILE, {
		type: "boolean",
		default: false,
		description: "Collect local monotonic CodeGraph operation timing aggregates",
	});
	pi.registerFlag(FLAG_ASCII_STATUS, {
		type: "boolean",
		default: false,
		description: "Use ASCII separators for the CodeGraph status segment",
	});

	registrar.registerAll();
	registerCodegraphCommand(pi, manager, () => Boolean(pi.getFlag(FLAG_AUTO_INDEX)));

	const updateSession = (ctx: ExtensionContext): void => {
		activeContext = ctx;
		activeRoot = canonicalRoot(ctx.cwd);
		manager.setProfiling(Boolean(pi.getFlag(FLAG_PROFILE)));
		registrar.setReady(false);
		if (ctx.hasUI) ctx.ui.setStatus(STATUS_KEY, formatStatus({
			kind: "starting",
			projectRoot: activeRoot,
			fresh: false,
			pendingPaths: [],
			watching: false,
			watcherDegraded: false,
			profileEnabled: manager.profileReport().enabled,
		}, Boolean(pi.getFlag(FLAG_ASCII_STATUS))));
	};

	const startFor = (ctx: ExtensionContext, root = canonicalRoot(ctx.cwd)): void => {
		if (disposed || !ctx.isProjectTrusted() || root !== activeRoot) return;
		void manager.start(root, {
			allowCreate: Boolean(pi.getFlag(FLAG_AUTO_INDEX)),
			signal: undefined,
		}).catch((error) => {
			if (ctx.hasUI && manager.snapshot().kind !== "missing") {
				ctx.ui.notify(`CodeGraph startup failed: ${error instanceof Error ? error.message : String(error)}`, "warning");
			}
		});
	};

	const unregisterMutation = pi.events.on(FILES_MUTATED_EVENT, (value) => {
		if (disposed) return;
		let event;
		try {
			event = parseFilesMutatedEvent(value);
		} catch {
			return;
		}
		if (event.projectRoot !== activeRoot) return;
		manager.invalidate(event.projectRoot, event.paths, mutationId(event));
	});

	pi.on("session_start", (_event, ctx) => {
		updateSession(ctx);
		if (!ctx.isProjectTrusted()) {
			registrar.setReady(false);
			if (ctx.hasUI) ctx.ui.setStatus(STATUS_KEY, undefined);
			return;
		}
		// Keep the tools callable while a missing index is reported. The first
		// tool call will ask whether the user wants to create it.
		registrar.setReady(true);
		startFor(ctx);
	});

	pi.on("resources_discover", (event, ctx) => {
		if (!activeRoot) updateSession(ctx);
		if (!ctx.isProjectTrusted()) return;
		registrar.setReady(true);
		startFor(ctx, canonicalRoot(event.cwd));
	});

	pi.on("tool_result", (event, ctx) => {
		if (event.isError || (event.toolName !== "edit" && event.toolName !== "write")) return;
		const path = event.input.path;
		if (typeof path !== "string" || !activeRoot || canonicalRoot(ctx.cwd) !== activeRoot) return;
		manager.invalidate(activeRoot, [path], `pi-${event.toolName}-${event.toolCallId}`);
	});

	pi.on("session_shutdown", async (_event, ctx) => {
		if (disposed) return;
		disposed = true;
		unregisterMutation();
		registrar.setReady(false);
		if (ctx.hasUI) ctx.ui.setStatus(STATUS_KEY, undefined);
		activeContext = undefined;
		activeRoot = undefined;
		await manager.shutdown();
	});
}

export { GraphManager, assertSupportedNodeVersion, loadOfficialCodeGraphApi } from "./graph-manager.ts";
export { parseFilesMutatedEvent, FILES_MUTATED_EVENT } from "./mutation-sync.ts";
export { resolveProjectRoot, assertActiveRoot } from "./paths.ts";
export { formatStatus, formatStatusReport } from "./status.ts";
export { OWNED_TOOL_NAMES } from "./types.ts";
