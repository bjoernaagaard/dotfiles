import type { GraphStats, Node } from "@colbymchenry/codegraph";
import type { CodeGraphInstance, OfficialCodeGraphApi } from "../extensions/types.ts";

export function node(name: string, filePath = "src/a.ts", line = 1): Node {
	return {
		id: `function:${filePath}:${name}:${line}`,
		kind: "function",
		name,
		qualifiedName: name,
		filePath,
		language: "typescript",
		startLine: line,
		endLine: line + 1,
		startColumn: 0,
		endColumn: 10,
		updatedAt: 1,
	};
}

export class FakeGraph implements CodeGraphInstance {
	closed = 0;
	unwatched = 0;
	watching = false;
	watchCalls = 0;
	syncCalls = 0;
	syncUnavailable = false;
	indexCalls = 0;
	pending: Array<{ path: string; firstSeenMs: number; lastSeenMs: number; indexing: boolean }> = [];
	nodes: Node[] = [node("greet"), node("caller", "src/b.ts", 4)];
	onSync?: () => Promise<void>;

	close(): void { this.closed += 1; }
	unwatch(): void { this.unwatched += 1; this.watching = false; }
	watch(): boolean { this.watchCalls += 1; this.watching = true; return true; }
	async waitUntilWatcherReady(): Promise<void> {}
	isWatching(): boolean { return this.watching; }
	isWatcherDegraded(): boolean { return false; }
	getWatcherDegradedReason(): string | null { return null; }
	getPendingFiles() { return this.pending; }
	getFile(filePath: string) { return this.getFiles().find((file) => file.path === filePath) ?? null; }
	getFiles() { return ["src/a.ts", "src/b.ts"].map((filePath) => ({ path: filePath, contentHash: "hash", language: "typescript" as const, size: 10, modifiedAt: 1, indexedAt: 1, nodeCount: this.nodes.filter((item) => item.filePath === filePath).length })); }
	getNodesInFile(filePath: string) { return this.nodes.filter((item) => item.filePath === filePath); }
	getFileDependencies() { return []; }
	getFileDependents() { return []; }
	async indexAll() { this.indexCalls += 1; return { success: true, filesIndexed: 2, filesSkipped: 0, filesErrored: 0, filesDiscovered: 2, nodesCreated: 2, edgesCreated: 1, errors: [], durationMs: 1 }; }
	async sync() {
		this.syncCalls += 1;
		await this.onSync?.();
		if (this.syncUnavailable) return { filesChecked: 0, filesAdded: 0, filesModified: 0, filesRemoved: 0, nodesUpdated: 0, durationMs: 0 };
		this.pending = [];
		return { filesChecked: 2, filesAdded: 0, filesModified: 1, filesRemoved: 0, nodesUpdated: 1, durationMs: 1, changedFilePaths: ["src/a.ts", "src/b.ts"] };
	}
	getStats(): GraphStats { return { nodeCount: this.nodes.length, edgeCount: 1, fileCount: 2, nodesByKind: { function: this.nodes.length } as GraphStats["nodesByKind"], edgesByKind: { calls: 1 } as GraphStats["edgesByKind"], filesByLanguage: { typescript: 2 } as GraphStats["filesByLanguage"], dbSizeBytes: 4096, lastUpdated: 1 }; }
	getIndexState() { return "complete" as const; }
	isIndexStale(): boolean { return false; }
	getBackend(): string { return "node-sqlite"; }
	getJournalMode(): string { return "wal"; }
	getLastIndexedAt(): number { return 1; }
	getPendingReferenceCount(): number { return 0; }
	getDetectedFrameworks(): string[] { return []; }
	getChangedFiles() { return { added: [], modified: [], removed: [] }; }
	getNode(id: string) { return this.nodes.find((item) => item.id === id) ?? null; }
	getNodesByName(name: string) { return this.nodes.filter((item) => item.name === name); }
	searchNodes(query: string) { return this.nodes.filter((item) => item.name.includes(query)).map((item, index) => ({ node: item, score: 10 - index })); }
	async buildContext(input: string) { return JSON.stringify({ query: input, codeBlocks: [{ filePath: "src/a.ts", content: "export function greet() {}" }] }); }
	getCallers(nodeId: string) { return this.nodes.filter((item) => item.id !== nodeId).map((item) => ({ node: item, edge: { source: item.id, target: nodeId, kind: "calls", provenance: "tree-sitter", metadata: { synthesizedBy: "callback", via: "register" } } })); }
	getCallees(nodeId: string) { return this.getCallers(nodeId); }
	getImpactRadius(nodeId: string) { return { nodes: new Map(this.nodes.map((item) => [item.id, item])), edges: [{ source: this.nodes[1]!.id, target: nodeId, kind: "calls" as const, provenance: "tree-sitter" as const }], roots: [nodeId] }; }
	async getCode(id: string) { return `// ${id}`; }
}

export function fakeApi(graph: FakeGraph, initialized = true): OfficialCodeGraphApi & { opens: number; inits: number; recreates: number } {
	const state = { opens: 0, inits: 0, recreates: 0 };
	return {
		get opens() { return state.opens; },
		get inits() { return state.inits; },
		get recreates() { return state.recreates; },
		CodeGraph: {
			isInitialized: () => initialized,
			open: async () => { state.opens += 1; return graph; },
			init: async () => { state.inits += 1; return graph; },
			recreate: async () => { state.recreates += 1; return graph; },
		},
	};
}
