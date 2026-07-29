import type {
	BuildContextOptions,
	FileRecord,
	GraphStats,
	IndexResult,
	Node,
	Logger,
	SearchOptions,
	SearchResult,
	Subgraph,
	SyncResult,
	WatchOptions,
} from "@colbymchenry/codegraph";

export type AbsPath = string;

export const STATUS_KEY = "codegraph";
export const FLAG_AUTO_INDEX = "codegraph-auto-index";
export const FLAG_PROFILE = "codegraph-profile";
export const FLAG_ASCII_STATUS = "codegraph-ascii-status";
export const DEFAULT_AUTO_INDEX = false;
export const PACKAGE_VERSION = "0.2.0";

export const PI_MAX_OUTPUT_BYTES = 50 * 1024;
export const PI_MAX_OUTPUT_LINES = 2000;

export const OWNED_TOOL_NAMES = [
	"codegraph_context",
	"codegraph_node",
	"codegraph_files",
	"codegraph_search",
	"codegraph_callers",
	"codegraph_callees",
	"codegraph_impact",
	"codegraph_stats",
	"codegraph_status",
] as const;

export type OwnedToolName = (typeof OWNED_TOOL_NAMES)[number];

export interface CodeGraphInstance {
	close(): void;
	unwatch(): void;
	watch(options?: WatchOptions): boolean;
	waitUntilWatcherReady(timeoutMs?: number): Promise<void>;
	isWatching(): boolean;
	isWatcherDegraded(): boolean;
	getWatcherDegradedReason(): string | null;
	getPendingFiles(): Array<{ path: string; firstSeenMs: number; lastSeenMs: number; indexing: boolean }>;
	getFile(filePath: string): FileRecord | null;
	getFiles(): FileRecord[];
	getNodesInFile(filePath: string): Node[];
	getFileDependencies(filePath: string): string[];
	getFileDependents(filePath: string): string[];
	indexAll(options?: { signal?: AbortSignal }): Promise<IndexResult>;
	sync(options?: { signal?: AbortSignal }): Promise<SyncResult>;
	getStats(): GraphStats;
	getIndexState(): "indexing" | "complete" | "partial" | "failed" | null;
	isIndexStale(): boolean;
	getBackend(): string;
	getJournalMode(): string;
	getLastIndexedAt(): number | null;
	getPendingReferenceCount(): number;
	getDetectedFrameworks(): string[];
	getChangedFiles(): { added: string[]; modified: string[]; removed: string[] };
	getNode(id: string): Node | null;
	getNodesByName(name: string): Node[];
	searchNodes(query: string, options?: SearchOptions): SearchResult[];
	buildContext(input: string, options?: BuildContextOptions): Promise<unknown>;
	getCallers(nodeId: string, maxDepth?: number): Array<{ node: Node; edge: unknown }>;
	getCallees(nodeId: string, maxDepth?: number): Array<{ node: Node; edge: unknown }>;
	getImpactRadius(nodeId: string, maxDepth?: number): Subgraph;
	getCode(nodeId: string): Promise<string | null>;
}

export interface CodeGraphStatic {
	isInitialized(projectRoot: string): boolean;
	init(projectRoot: string, options?: { index?: boolean }): Promise<CodeGraphInstance>;
	open(projectRoot: string, options?: { sync?: boolean; readOnly?: boolean }): Promise<CodeGraphInstance>;
	recreate(projectRoot: string): Promise<CodeGraphInstance>;
}

export interface OfficialCodeGraphApi {
	CodeGraph: CodeGraphStatic;
	/** Embedded hosts should replace the SDK's console logger with a host-owned logger. */
	setLogger?: (logger: Logger) => void;
	silentLogger?: Logger;
}

export type GraphLifecycleKind =
	| "idle"
	| "missing"
	| "starting"
	| "indexing"
	| "syncing"
	| "ready"
	| "stale"
	| "failed"
	| "closed";

export interface GraphSnapshot {
	kind: GraphLifecycleKind;
	projectRoot?: AbsPath;
	message?: string;
	fresh: boolean;
	pendingPaths: string[];
	watching: boolean;
	watcherDegraded: boolean;
	stats?: GraphStats;
	lastOperation?: string;
	lastDurationMs?: number;
	lastIndexedAt?: number | null;
	profileEnabled: boolean;
}

export interface StartOptions {
	allowCreate: boolean;
	forceReindex?: boolean;
	signal?: AbortSignal;
}

export interface FilesMutatedEvent {
	schemaVersion: 1;
	source: string;
	projectRoot: AbsPath;
	paths: string[];
	canonicalPaths?: string[];
	transactionId?: string;
	operation?: string;
	state?: string;
	emittedAt: string;
}

export type IndexFreshness =
	| { state: "fresh"; syncedAt: string }
	| { state: "stale"; mutationId: string; pendingPaths: string[] }
	| { state: "syncing"; mutationId: string; pendingPaths: string[] }
	| { state: "failed"; mutationId: string; message: string };

export interface ProfileAggregate {
	count: number;
	failures: number;
	totalMs: number;
	minMs: number;
	maxMs: number;
	lastMs: number;
	averageMs: number;
	outputBytes: number;
}

export interface ProfileReport {
	enabled: boolean;
	operations: Record<string, ProfileAggregate>;
}
