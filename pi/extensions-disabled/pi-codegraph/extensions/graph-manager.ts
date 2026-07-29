import { createRequire } from "node:module";
import { performance } from "node:perf_hooks";
import type { SyncResult } from "@colbymchenry/codegraph";
import { canonicalRoot, projectRelativePath } from "./paths.ts";
import { OperationProfiler } from "./profiler.ts";
import type {
	AbsPath,
	CodeGraphInstance,
	GraphSnapshot,
	IndexFreshness,
	OfficialCodeGraphApi,
	ProfileReport,
	StartOptions,
} from "./types.ts";

const require = createRequire(import.meta.url);
const LOCK_UNAVAILABLE_MESSAGE = "CodeGraph file lock unavailable; another process is writing. Run /codegraph sync after it finishes.";

function isLockUnavailableSyncResult(result: SyncResult): boolean {
	return result.filesChecked === 0
		&& result.filesAdded === 0
		&& result.filesModified === 0
		&& result.filesRemoved === 0
		&& result.nodesUpdated === 0
		&& result.durationMs === 0;
}

export interface GraphManagerOptions {
	loadApi?: () => OfficialCodeGraphApi;
	nodeVersion?: string;
	profile?: boolean;
	watchDebounceMs?: number;
	now?: () => Date;
	onStateChange?: (snapshot: GraphSnapshot) => void;
}

export function loadOfficialCodeGraphApi(): OfficialCodeGraphApi {
	const sdk = require("@colbymchenry/codegraph") as OfficialCodeGraphApi;
	if (!sdk?.CodeGraph) throw new Error("@colbymchenry/codegraph did not expose CodeGraph");
	// This SDK runs inside Pi's TUI. Its default console logger writes warnings
	// directly into the active transcript, so background watcher diagnostics can
	// obscure the agent's work. Lifecycle failures are surfaced through the
	// manager snapshot and host notifications instead.
	sdk.setLogger?.(sdk.silentLogger ?? { debug() {}, warn() {}, error() {} });
	return sdk;
}

export function assertSupportedNodeVersion(version: string): void {
	const match = /^(\d+)\.(\d+)\.(\d+)/u.exec(version);
	if (!match) throw new Error(`Unsupported Node.js version ${version}; CodeGraph requires >=22.5 <25`);
	const major = Number(match[1]);
	const minor = Number(match[2]);
	if (major < 22 || (major === 22 && minor < 5) || major >= 25) {
		throw new Error(`Unsupported Node.js ${version}; embedded CodeGraph requires Node.js >=22.5 <25`);
	}
}

function abortError(): Error {
	const error = new Error("CodeGraph operation aborted");
	error.name = "AbortError";
	return error;
}

function checkAbort(signal?: AbortSignal): void {
	if (signal?.aborted) throw abortError();
}

function messageOf(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

function outputBytes(value: unknown): number {
	try {
		return Buffer.byteLength(typeof value === "string" ? value : JSON.stringify(value), "utf8");
	} catch {
		return 0;
	}
}

export class GraphManager {
	private readonly loadApi: () => OfficialCodeGraphApi;
	private readonly nodeVersion: string;
	private readonly watchDebounceMs: number;
	private readonly now: () => Date;
	private readonly onStateChange?: (snapshot: GraphSnapshot) => void;
	private readonly profiler: OperationProfiler;

	private graph?: CodeGraphInstance;
	private root?: AbsPath;
	private snapshotValue: GraphSnapshot;
	private operationTail: Promise<void> = Promise.resolve();
	private startup?: { root: AbsPath; promise: Promise<CodeGraphInstance> };
	private disposed = false;
	private mutationGeneration = 0;
	private syncedGeneration = 0;
	private mutationId = "startup";
	private mutationStartedAt?: number;
	private readonly pendingPaths = new Set<string>();
	private drainRunning = false;
	private drainPromise?: Promise<void>;
	private syncBlocked = false;
	private syncAbort = new AbortController();

	constructor(options: GraphManagerOptions = {}) {
		this.loadApi = options.loadApi ?? loadOfficialCodeGraphApi;
		this.nodeVersion = options.nodeVersion ?? process.versions.node;
		this.watchDebounceMs = options.watchDebounceMs ?? 250;
		this.now = options.now ?? (() => new Date());
		this.onStateChange = options.onStateChange;
		this.profiler = new OperationProfiler(options.profile ?? false);
		this.snapshotValue = {
			kind: "idle",
			fresh: false,
			pendingPaths: [],
			watching: false,
			watcherDegraded: false,
			profileEnabled: this.profiler.enabled,
		};
	}

	snapshot(): GraphSnapshot {
		this.detectWatcherPending();
		return {
			...this.snapshotValue,
			pendingPaths: [...this.snapshotValue.pendingPaths],
			stats: this.snapshotValue.stats ? { ...this.snapshotValue.stats } : undefined,
		};
	}

	freshness(): IndexFreshness {
		const snapshot = this.snapshot();
		if (snapshot.kind === "ready" && snapshot.fresh) {
			return { state: "fresh", syncedAt: this.now().toISOString() };
		}
		if (snapshot.kind === "failed") {
			return { state: "failed", mutationId: this.mutationId, message: snapshot.message ?? "unknown failure" };
		}
		return {
			state: snapshot.kind === "syncing" ? "syncing" : "stale",
			mutationId: this.mutationId,
			pendingPaths: [...snapshot.pendingPaths],
		};
	}

	setProfiling(enabled: boolean): void {
		this.profiler.setEnabled(enabled);
		this.update({ profileEnabled: enabled });
	}

	profileReport(): ProfileReport {
		return this.profiler.report();
	}

	async start(projectRoot: AbsPath, options: StartOptions): Promise<CodeGraphInstance> {
		if (this.disposed) throw new Error("CodeGraph manager is closed");
		checkAbort(options.signal);
		const root = canonicalRoot(projectRoot);
		if (!options.forceReindex && this.graph && this.root === root) {
			this.profiler.record("startup.warm", this.profiler.start(), 0);
			return this.graph;
		}
		if (!options.forceReindex && this.startup?.root === root) return this.startup.promise;

		const promise = this.enqueue(async () => {
			checkAbort(options.signal);
			assertSupportedNodeVersion(this.nodeVersion);
			const generationAtStart = this.mutationGeneration;
			if (this.root !== root || options.forceReindex) this.closeCurrent();
			this.root = root;
			this.update({
				kind: "starting",
				projectRoot: root,
				fresh: false,
				message: undefined,
				pendingPaths: [...this.pendingPaths].sort(),
				lastOperation: "startup",
			});

			const startedAt = this.profiler.start();
			const api = this.loadApi();
			const initialized = api.CodeGraph.isInitialized(root);
			let graph: CodeGraphInstance;

			if (options.forceReindex && initialized) {
				this.update({ kind: "indexing", lastOperation: "recreate" });
				graph = await api.CodeGraph.recreate(root);
				this.graph = graph;
				checkAbort(options.signal);
				await this.measureOfficial("index.full", () => graph.indexAll({ signal: options.signal }));
			} else if (initialized) {
				graph = await api.CodeGraph.open(root, { sync: false, readOnly: false });
				this.graph = graph;
				this.update({ kind: "syncing", lastOperation: "startup sync" });
				const startupSync = await this.measureOfficial("sync.startup", () => graph.sync({ signal: options.signal }));
				if (isLockUnavailableSyncResult(startupSync)) throw new Error(LOCK_UNAVAILABLE_MESSAGE);
				checkAbort(options.signal);
				if (graph.getIndexState() !== "complete" || graph.isIndexStale()) {
					this.update({ kind: "indexing", lastOperation: "index refresh" });
					await this.measureOfficial("index.refresh", () => graph.indexAll({ signal: options.signal }));
				}
			} else {
				if (!options.allowCreate) {
					this.update({ kind: "missing", message: "No CodeGraph index; run /codegraph init" });
					throw new Error(`No CodeGraph index for ${root}. Run /codegraph init.`);
				}
				this.update({ kind: "indexing", lastOperation: "init" });
				graph = await api.CodeGraph.init(root, { index: false });
				this.graph = graph;
				await this.measureOfficial("index.cold", () => graph.indexAll({ signal: options.signal }));
			}

			checkAbort(options.signal);
			this.graph = graph;
			const watching = await this.startWatcher(graph);
			const stats = graph.getStats();
			const durationMs = this.profiler.record(initialized ? "startup.open" : "startup.cold", startedAt, startedAt === undefined ? 0 : outputBytes(stats));
			this.syncedGeneration = Math.max(this.syncedGeneration, generationAtStart);
			const startupFresh = this.syncedGeneration === this.mutationGeneration;
			if (startupFresh) this.pendingPaths.clear();
			this.update({
				kind: startupFresh ? "ready" : "stale",
				projectRoot: root,
				fresh: startupFresh,
				watching,
				watcherDegraded: graph.isWatcherDegraded(),
				stats,
				lastIndexedAt: graph.getLastIndexedAt(),
				lastOperation: initialized ? "opened" : "initialized",
				lastDurationMs: durationMs,
				message: graph.getWatcherDegradedReason() ?? undefined,
				pendingPaths: [...this.pendingPaths].sort(),
			});
			return graph;
		});

		this.startup = { root, promise };
		try {
			const graph = await promise;
			if (this.mutationGeneration > this.syncedGeneration) this.scheduleDrain();
			return graph;
		} catch (error) {
			if (this.snapshotValue.kind !== "missing") this.fail(messageOf(error));
			throw error;
		} finally {
			if (this.startup?.promise === promise) this.startup = undefined;
		}
	}

	async query<T>(name: string, signal: AbortSignal | undefined, operation: (graph: CodeGraphInstance) => Promise<T> | T): Promise<T> {
		checkAbort(signal);
		this.assertQueryable();
		return this.enqueue(async () => {
			checkAbort(signal);
			this.assertQueryable();
			const graph = this.graph;
			if (!graph) throw new Error("CodeGraph is not ready");
			const result = await this.profiler.measure(`query.${name}`, () => operation(graph), outputBytes);
			checkAbort(signal);
			this.detectWatcherPending();
			this.assertQueryable();
			return result;
		});
	}

	invalidate(projectRoot: AbsPath, paths: readonly string[], mutationId: string): boolean {
		if (this.disposed || !this.root) return false;
		let root: string;
		try {
			root = canonicalRoot(projectRoot);
		} catch {
			return false;
		}
		if (root !== this.root) return false;
		const normalizedPaths: string[] = [];
		for (const candidate of paths) {
			try {
				normalizedPaths.push(projectRelativePath(root, candidate));
			} catch {
				return false;
			}
		}
		for (const candidate of normalizedPaths) this.pendingPaths.add(candidate);
		this.syncBlocked = false;
		this.mutationGeneration += 1;
		this.mutationId = mutationId;
		this.mutationStartedAt ??= this.profiler.enabled ? performance.now() : undefined;
		// Stop the official debounce loop before entering our serialized sync queue.
		// This avoids a watcher sync racing a built-in/shared mutation sync.
		this.graph?.unwatch();
		this.update({
			kind: "stale",
			fresh: false,
			watching: false,
			watcherDegraded: false,
			message: undefined,
			pendingPaths: [...this.pendingPaths].sort(),
			lastOperation: "mutation pending",
		});
		this.scheduleDrain();
		return true;
	}

	async sync(projectRoot: AbsPath, signal?: AbortSignal): Promise<void> {
		const root = canonicalRoot(projectRoot);
		if (root !== this.root || !this.graph) throw new Error(`No open CodeGraph instance for ${root}`);
		this.syncAbort.abort();
		this.syncAbort = new AbortController();
		const controller = this.syncAbort;
		const onAbort = () => controller.abort();
		if (signal?.aborted) throw abortError();
		signal?.addEventListener("abort", onAbort, { once: true });
		try {
			this.invalidate(root, [], `manual-${this.mutationGeneration + 1}`);
			await this.whenIdle();
			if (this.snapshotValue.kind === "failed") throw new Error(this.snapshotValue.message ?? "CodeGraph sync failed");
		} finally {
			signal?.removeEventListener("abort", onAbort);
		}
	}

	async whenIdle(): Promise<void> {
		while (this.drainPromise || this.drainRunning || (!this.disposed && !this.syncBlocked && this.graph && this.syncedGeneration < this.mutationGeneration)) {
			if (this.drainPromise) await this.drainPromise;
			else await new Promise<void>((resolve) => queueMicrotask(resolve));
		}
		await this.operationTail;
	}

	async shutdown(): Promise<void> {
		if (this.disposed) return;
		this.disposed = true;
		this.syncAbort.abort();
		await this.enqueue(async () => this.closeCurrent());
		this.profiler.clear();
		this.update({ kind: "closed", fresh: false, pendingPaths: [], watching: false });
	}

	private enqueue<T>(operation: () => Promise<T> | T): Promise<T> {
		const result = this.operationTail.then(operation, operation);
		this.operationTail = result.then(() => undefined, () => undefined);
		return result;
	}

	private closeCurrent(): void {
		const graph = this.graph;
		this.graph = undefined;
		if (!graph) return;
		try {
			graph.unwatch();
		} finally {
			graph.close();
		}
	}

	private async measureOfficial<T>(name: string, operation: () => Promise<T>): Promise<T> {
		return this.profiler.measure(name, operation, outputBytes);
	}

	private detectWatcherPending(): void {
		const graph = this.graph;
		if (!graph || this.disposed || this.snapshotValue.kind === "syncing" || this.snapshotValue.kind === "indexing") return;
		const pending = graph.getPendingFiles();
		if (pending.length === 0) return;
		let changed = false;
		for (const item of pending) {
			const size = this.pendingPaths.size;
			this.pendingPaths.add(item.path);
			changed ||= this.pendingPaths.size !== size;
		}
		if (this.mutationGeneration === this.syncedGeneration) {
			this.mutationGeneration += 1;
			this.mutationId = `watch-${this.mutationGeneration}`;
			this.mutationStartedAt ??= this.profiler.enabled ? performance.now() : undefined;
			changed = true;
		}
		if (changed || this.snapshotValue.kind !== "stale") {
			graph.unwatch();
			this.update({ kind: "stale", fresh: false, watching: false, pendingPaths: [...this.pendingPaths].sort(), lastOperation: "watch pending" });
		}
		this.scheduleDrain();
	}

	private scheduleDrain(): void {
		if (this.disposed || this.drainRunning || this.syncBlocked || !this.graph) return;
		queueMicrotask(() => {
			if (this.disposed || this.drainRunning || this.syncBlocked || !this.graph) return;
			this.drainRunning = true;
			const task = this.drainMutations().finally(() => {
				this.drainRunning = false;
				if (this.drainPromise === task) this.drainPromise = undefined;
				if (!this.disposed && !this.syncBlocked && this.mutationGeneration > this.syncedGeneration) this.scheduleDrain();
			});
			this.drainPromise = task;
		});
	}

	private async drainMutations(): Promise<void> {
		while (!this.disposed && !this.syncBlocked && this.graph && this.syncedGeneration < this.mutationGeneration) {
			const targetGeneration = this.mutationGeneration;
			const pendingPaths = [...this.pendingPaths].sort();
			this.update({ kind: "syncing", fresh: false, pendingPaths, lastOperation: "mutation sync" });
			try {
				const completed = await this.enqueue(async () => {
					const graph = this.graph;
					if (!graph || this.disposed) return false;
					const result = await this.measureOfficial("sync.mutation", () => graph.sync({ signal: this.syncAbort.signal }));
					if (this.disposed || this.graph !== graph) return false;
					if (isLockUnavailableSyncResult(result)) {
						this.blockSync();
						return false;
					}
					this.syncedGeneration = targetGeneration;
					for (const changed of result.changedFilePaths ?? pendingPaths) this.pendingPaths.delete(changed.split("\\").join("/"));
					if (this.syncedGeneration < this.mutationGeneration) {
						this.update({ kind: "stale", fresh: false, pendingPaths: [...this.pendingPaths].sort() });
						return true;
					}
					const stats = graph.getStats();
					const mutationDuration = this.profiler.record("mutation.to_fresh", this.mutationStartedAt, this.mutationStartedAt === undefined ? 0 : outputBytes(result));
					this.mutationStartedAt = undefined;
					this.pendingPaths.clear();
					const watching = await this.startWatcher(graph);
					this.update({
						kind: "ready",
						fresh: true,
						pendingPaths: [],
						stats,
						lastIndexedAt: graph.getLastIndexedAt(),
						lastOperation: "mutation synced",
						lastDurationMs: mutationDuration ?? result.durationMs,
						watching,
						watcherDegraded: graph.isWatcherDegraded(),
						message: undefined,
					});
					return true;
				});
				if (!completed) return;
			} catch (error) {
				if (this.disposed || this.syncAbort.signal.aborted) return;
				this.fail(`sync failed: ${messageOf(error)}`);
				return;
			}
		}
	}

	private async startWatcher(graph: CodeGraphInstance): Promise<boolean> {
		const watching = graph.watch({
			debounceMs: this.watchDebounceMs,
			onSyncComplete: ({ durationMs }) => this.onWatcherSync(durationMs),
			onSyncError: (error) => this.fail(`watch sync failed: ${error.message}`),
			onDegraded: (reason) => this.markWatcherDegraded(reason),
		});
		if (watching) await graph.waitUntilWatcherReady();
		return watching;
	}

	private onWatcherSync(durationMs: number): void {
		if (this.disposed || !this.graph) return;
		this.profiler.record("sync.watch", this.profiler.enabled ? performance.now() - durationMs : undefined);
		if (this.mutationGeneration > this.syncedGeneration) return;
		this.update({
			kind: "ready",
			fresh: true,
			pendingPaths: [],
			stats: this.graph.getStats(),
			lastIndexedAt: this.graph.getLastIndexedAt(),
			lastOperation: "watch synced",
			lastDurationMs: durationMs,
			watching: this.graph.isWatching(),
			message: undefined,
			watcherDegraded: this.graph.isWatcherDegraded(),
		});
	}

	private assertQueryable(): void {
		this.detectWatcherPending();
		const snapshot = this.snapshotValue;
		if (!this.graph || snapshot.kind !== "ready" || !snapshot.fresh) {
			throw new Error(`CodeGraph is ${snapshot.kind}${snapshot.message ? `: ${snapshot.message}` : ""}. Wait for a fresh index or run /codegraph sync.`);
		}
	}

	private blockSync(): void {
		this.syncBlocked = true;
		this.update({
			kind: "failed",
			fresh: false,
			message: LOCK_UNAVAILABLE_MESSAGE,
			watching: false,
			watcherDegraded: false,
			pendingPaths: [...this.pendingPaths].sort(),
			lastOperation: "mutation sync blocked",
		});
	}

	private markWatcherDegraded(reason: string): void {
		if (this.disposed) return;
		this.update({
			kind: "failed",
			fresh: false,
			message: reason,
			watching: false,
			watcherDegraded: true,
			pendingPaths: [...this.pendingPaths].sort(),
			lastOperation: "watcher degraded",
		});
	}

	private fail(message: string): void {
		this.update({ kind: "failed", fresh: false, message, pendingPaths: [...this.pendingPaths].sort() });
	}

	private update(patch: Partial<GraphSnapshot>): void {
		this.snapshotValue = {
			...this.snapshotValue,
			...patch,
			projectRoot: patch.projectRoot ?? this.root ?? this.snapshotValue.projectRoot,
			profileEnabled: this.profiler.enabled,
		};
		this.onStateChange?.(this.snapshot());
	}
}
