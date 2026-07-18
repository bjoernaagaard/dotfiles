import { readFile } from "node:fs/promises";
import path from "node:path";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { FileRecord, Node, NodeKind } from "@colbymchenry/codegraph";
import { Type } from "typebox";
import type { GraphManager } from "./graph-manager.ts";
import { assertActiveRoot, projectRelativePath } from "./paths.ts";
import { truncateToolText } from "./truncate.ts";
import { OWNED_TOOL_NAMES, type CodeGraphInstance, type OwnedToolName } from "./types.ts";

const NODE_KIND_PATTERN = "^(file|module|class|struct|interface|trait|protocol|function|method|property|field|variable|constant|enum|enum_member|type_alias|namespace|parameter|import|export|route|component)$";
const strict = { additionalProperties: false } as const;

const rootParam = Type.Optional(Type.String({ description: "Active project root only" }));
const queryParam = Type.String({ minLength: 1, maxLength: 500 });
const symbolParam = Type.String({ minLength: 1, maxLength: 500, description: "Symbol name, qualified name, or CodeGraph node id" });
const fileParam = Type.Optional(Type.String({ minLength: 1, maxLength: 1000, description: "Project-relative file used to disambiguate a symbol" }));
const depthParam = Type.Optional(Type.Integer({ minimum: 1, maximum: 5, default: 1 }));
const limitParam = Type.Optional(Type.Integer({ minimum: 1, maximum: 100, default: 25 }));
const lineParam = Type.Optional(Type.Integer({ minimum: 1, maximum: 1_000_000 }));
const offsetParam = Type.Optional(Type.Integer({ minimum: 1, maximum: 1_000_000 }));
const lineLimitParam = Type.Optional(Type.Integer({ minimum: 1, maximum: 2000 }));
const trailLimitParam = Type.Optional(Type.Integer({ minimum: 1, maximum: 100, default: 12 }));
const fileLimitParam = Type.Optional(Type.Integer({ minimum: 1, maximum: 1000, default: 200 }));
const fileFormatParam = Type.Optional(Type.String({ pattern: "^(tree|flat|grouped)$", default: "tree" }));
const GLOB_REGEX_SPECIALS = new Set(["\\", "^", "$", "+", "?", ".", "(", ")", "|", "{", "}", "[", "]"]);

interface ToolDetails {
	tool: OwnedToolName;
	projectRoot: string;
	freshness: ReturnType<GraphManager["freshness"]>;
	truncated: boolean;
	truncatedOutputPath?: string;
	totalBytes: number;
	outputBytes: number;
}

interface ResolvedSymbol {
	status: "resolved";
	node: Node;
}

interface UnresolvedSymbol {
	status: "not_found" | "ambiguous";
	query: string;
	candidates: ReturnType<typeof compactNode>[];
}

type SymbolResolution = ResolvedSymbol | UnresolvedSymbol;

function compactNode(node: Node) {
	return {
		id: node.id,
		name: node.name,
		qualifiedName: node.qualifiedName,
		kind: node.kind,
		filePath: node.filePath,
		startLine: node.startLine,
		endLine: node.endLine,
		signature: node.signature ?? undefined,
		isExported: node.isExported ?? undefined,
	};
}

function compactEdge(edge: unknown): unknown {
	if (!edge || typeof edge !== "object") return edge;
	const value = edge as Record<string, unknown>;
	return {
		source: value.source,
		target: value.target,
		kind: value.kind,
		line: value.line,
		column: value.column,
		provenance: value.provenance ?? "unknown",
		metadata: value.metadata,
	};
}

function compactFile(file: FileRecord, includeMetadata = true): Record<string, unknown> {
	if (!includeMetadata) return { path: file.path };
	return {
		path: file.path,
		language: file.language,
		nodeCount: file.nodeCount,
		size: file.size,
		indexedAt: file.indexedAt,
	};
}

function compareNodes(left: Node, right: Node): number {
	return left.filePath.localeCompare(right.filePath) || left.startLine - right.startLine || left.qualifiedName.localeCompare(right.qualifiedName) || left.id.localeCompare(right.id);
}

function matchesFileHint(root: string, candidatePath: string, fileHint: string): boolean {
	const normalized = projectRelativePath(root, fileHint.replaceAll("\\", "/"));
	return candidatePath === normalized || path.posix.basename(candidatePath) === path.posix.basename(normalized);
}

function resolveNodeCandidates(graph: CodeGraphInstance, root: string, symbol: string, filePath?: string, line?: number): Node[] {
	const byId = graph.getNode(symbol);
	if (byId) return [byId];
	let candidates = graph.getNodesByName(symbol);
	if (candidates.length === 0) {
		candidates = graph.searchNodes(symbol, { limit: 25 }).map((result) => result.node);
		const qualified = candidates.filter((node) => node.qualifiedName === symbol);
		if (qualified.length > 0) candidates = qualified;
	}
	if (filePath) candidates = candidates.filter((node) => matchesFileHint(root, node.filePath, filePath));
	if (line !== undefined) {
		const atLine = candidates.filter((node) => node.startLine <= line && node.endLine >= line);
		if (atLine.length > 0) candidates = atLine;
	}
	return [...new Map(candidates.map((node) => [node.id, node])).values()].sort(compareNodes);
}

function resolveSymbol(graph: CodeGraphInstance, root: string, symbol: string, filePath?: string): SymbolResolution {
	const candidates = resolveNodeCandidates(graph, root, symbol, filePath);
	if (candidates.length === 1) return { status: "resolved", node: candidates[0]! };
	return {
		status: candidates.length === 0 ? "not_found" : "ambiguous",
		query: symbol,
		candidates: candidates.slice(0, 25).map(compactNode),
	};
}

type FileResolution =
	| { status: "resolved"; file: FileRecord }
	| { status: "not_found"; query: string }
	| { status: "ambiguous"; query: string; candidates: ReturnType<typeof compactFile>[] };

function resolveFile(graph: CodeGraphInstance, root: string, requested: string): FileResolution {
	const relative = projectRelativePath(root, requested.replaceAll("\\", "/"));
	const exact = graph.getFile(relative);
	if (exact) return { status: "resolved", file: exact };
	const basename = path.posix.basename(relative);
	const candidates = graph.getFiles().filter((file) => path.posix.basename(file.path) === basename).sort((left, right) => left.path.localeCompare(right.path));
	if (candidates.length === 1) return { status: "resolved", file: candidates[0]! };
	if (candidates.length > 1) return { status: "ambiguous", query: requested, candidates: candidates.map((file) => compactFile(file)) };
	return { status: "not_found", query: requested };
}

const CONTAINER_NODE_KINDS = new Set<NodeKind>(["class", "struct", "interface", "trait", "protocol", "enum", "namespace", "module"]);

async function nodePayload(graph: CodeGraphInstance, node: Node, includeCode: boolean, depth: number, limit: number, signal?: AbortSignal): Promise<Record<string, unknown>> {
	const callers = graph.getCallers(node.id, depth).slice(0, limit);
	const callees = graph.getCallees(node.id, depth).slice(0, limit);
	const payload: Record<string, unknown> = {
		node: compactNode(node),
		callers: callers.map((item) => ({ node: compactNode(item.node), edge: compactEdge(item.edge) })),
		callees: callees.map((item) => ({ node: compactNode(item.node), edge: compactEdge(item.edge) })),
	};
	if (!includeCode) return payload;
	if (CONTAINER_NODE_KINDS.has(node.kind)) {
		payload.outline = graph.getNodesInFile(node.filePath)
			.filter((member) => member.id !== node.id && member.startLine >= node.startLine && member.endLine <= node.endLine)
			.sort(compareNodes)
			.slice(0, 100)
			.map(compactNode);
	} else {
		if (signal?.aborted) throw new Error("CodeGraph operation aborted");
		payload.source = await graph.getCode(node.id);
	}
	return payload;
}

function keySummary(source: string, offset: number, limit: number): string[] {
	return source.split(/\r?\n/u)
		.slice(offset - 1, offset - 1 + limit)
		.map((line, index) => {
			const match = /^\s*([^#;\s][^:=]*?)\s*[:=]/u.exec(line);
			return match ? `${offset + index}\t${match[1]!.trim()}` : undefined;
		})
		.filter((line): line is string => line !== undefined);
}

async function filePayload(
	graph: CodeGraphInstance,
	root: string,
	requested: string,
	options: { offset: number; lineLimit: number; symbolsOnly: boolean; signal?: AbortSignal },
): Promise<Record<string, unknown>> {
	const resolution = resolveFile(graph, root, requested);
	if (resolution.status !== "resolved") return resolution;
	const file = resolution.file;
	const symbols = graph.getNodesInFile(file.path).sort(compareNodes).map(compactNode);
	const payload: Record<string, unknown> = {
		mode: "file",
		file: compactFile(file),
		dependencies: graph.getFileDependencies(file.path).slice(0, 100),
		dependents: graph.getFileDependents(file.path).slice(0, 100),
		symbols,
	};
	if (options.symbolsOnly) return { ...payload, symbolsOnly: true };
	if (options.signal?.aborted) throw new Error("CodeGraph operation aborted");
	const source = await readFile(path.join(root, file.path), "utf8");
	if (options.signal?.aborted) throw new Error("CodeGraph operation aborted");
	const protectedFile = /\.(?:ya?ml|properties)$/iu.test(file.path);
	if (protectedFile) {
		return {
			...payload,
			protectedSource: true,
			summary: keySummary(source, options.offset, options.lineLimit).join("\n"),
		};
	}
	const lines = source.split(/\r?\n/u);
	const shown = lines.slice(options.offset - 1, options.offset - 1 + options.lineLimit);
	const end = options.offset - 1 + shown.length;
	return {
		...payload,
		source: shown.map((line, index) => `${options.offset + index}\t${line}`).join("\n"),
		range: { offset: options.offset, limit: shown.length, totalLines: lines.length, complete: options.offset === 1 && end >= lines.length },
	};
}

function globRegex(pattern: string): RegExp {
	let source = "";
	for (let index = 0; index < pattern.length;) {
		if (pattern.startsWith("**/", index)) {
			source += "(?:.*/)?";
			index += 3;
		} else if (pattern.startsWith("**", index)) {
			source += ".*";
			index += 2;
		} else {
			const char = pattern[index]!;
			if (char === "*") source += "[^/]*";
			else if (char === "?") source += "[^/]";
			else source += GLOB_REGEX_SPECIALS.has(char) ? `\\${char}` : char;
			index += 1;
		}
	}
	return new RegExp(`^${source}$`, "u");
}

function fileTree(files: readonly Record<string, unknown>[], maxDepth?: number): Record<string, unknown> {
	type Directory = { path: string; files: Record<string, unknown>[]; directories: Map<string, Directory> };
	const root: Directory = { path: ".", files: [], directories: new Map() };
	for (const file of files) {
		const filePath = String(file.path);
		const parts = filePath.split("/");
		const directoryParts = parts.slice(0, -1);
		if (maxDepth !== undefined && directoryParts.length > maxDepth) continue;
		let current = root;
		for (let index = 0; index < directoryParts.length; index += 1) {
			const name = directoryParts[index]!;
			let child = current.directories.get(name);
			if (!child) {
				child = { path: directoryParts.slice(0, index + 1).join("/"), files: [], directories: new Map() };
				current.directories.set(name, child);
			}
			current = child;
		}
		current.files.push(file);
	}
	const render = (directory: Directory): Record<string, unknown> => ({
		path: directory.path,
		files: directory.files.sort((left, right) => String(left.path).localeCompare(String(right.path))),
		directories: [...directory.directories.values()].sort((left, right) => left.path.localeCompare(right.path)).map(render),
	});
	return render(root);
}

async function addSource(graph: CodeGraphInstance, node: Node, includeSource: boolean, signal?: AbortSignal): Promise<Record<string, unknown>> {
	if (signal?.aborted) throw new Error("CodeGraph operation aborted");
	return {
		...compactNode(node),
		...(includeSource ? { source: await graph.getCode(node.id) } : {}),
	};
}

function result(tool: OwnedToolName, root: string, manager: GraphManager, value: unknown) {
	const text = typeof value === "string" ? value : JSON.stringify(value, null, 2);
	const truncated = truncateToolText(text);
	const details: ToolDetails = {
		tool,
		projectRoot: root,
		freshness: manager.freshness(),
		truncated: truncated.truncated,
		truncatedOutputPath: truncated.truncatedOutputPath,
		totalBytes: truncated.totalBytes,
		outputBytes: truncated.outputBytes,
	};
	return { content: [{ type: "text" as const, text: truncated.text }], details };
}

function rootFor(ctx: ExtensionContext, requested: unknown): string {
	if (!ctx.isProjectTrusted()) throw new Error("CodeGraph tools require a trusted project");
	return assertActiveRoot(ctx.cwd, requested);
}

export class ToolRegistrar {
	private readonly pi: ExtensionAPI;
	private readonly manager: GraphManager;
	private readonly allowCreate: () => boolean;
	private active = false;

	constructor(pi: ExtensionAPI, manager: GraphManager, allowCreate: () => boolean) {
		this.pi = pi;
		this.manager = manager;
		this.allowCreate = allowCreate;
	}

	registerAll(): void {
		const manager = this.manager;
		const allowCreate = this.allowCreate;

		this.pi.registerTool({
			name: "codegraph_context",
			label: "CodeGraph Context",
			description: "Primary CodeGraph exploration tool. Builds bounded graph context with relevant source for an architecture, flow, or bug-localization question.",
			promptSnippet: "Explore indexed architecture, flows, symbols, relationships, and source context",
			promptGuidelines: ["Use codegraph_context first for architecture, flow, impact discovery, or bug localization; use a syntax-aware matcher or LSP for syntax-precise or semantic edits."],
			parameters: Type.Object({
				query: queryParam,
				projectPath: rootParam,
				maxNodes: Type.Optional(Type.Integer({ minimum: 1, maximum: 100, default: 40 })),
				maxCodeBlocks: Type.Optional(Type.Integer({ minimum: 0, maximum: 20, default: 8 })),
				includeCode: Type.Optional(Type.Boolean({ default: true })),
			}, strict),
			async execute(_id, params, signal, _update, ctx) {
				const root = rootFor(ctx, params.projectPath);
				await manager.start(root, { allowCreate: allowCreate(), signal });
				const context = await manager.query("context", signal, (graph) => graph.buildContext(params.query, {
					format: "json",
					maxNodes: params.maxNodes ?? 40,
					maxCodeBlocks: params.maxCodeBlocks ?? 8,
					includeCode: params.includeCode ?? true,
				}));
				let payload: unknown = context;
				if (typeof context === "string") {
					try { payload = JSON.parse(context); } catch { payload = context; }
				}
				return result("codegraph_context", root, manager, {
					bestEffort: true,
					boundary: "Graph edges are static-analysis evidence, not complete semantic references. Use a syntax-aware matcher plus LSP, typecheck, and tests for edits.",
					context: payload,
				});
			},
		});

		this.pi.registerTool({
			name: "codegraph_node",
			label: "CodeGraph Node",
			description: "Read one indexed file or symbol with a compact caller/callee trail. File reads include line numbers, symbol structure, and file dependencies; symbol bodies are opt-in.",
			promptSnippet: "Read one indexed file or symbol with structure and dependency trail",
			promptGuidelines: ["Use codegraph_node instead of broad file reads when you need one file or symbol; use codegraph_context for several related symbols or a complete flow."],
			parameters: Type.Object({
				symbol: Type.Optional(symbolParam),
				file: fileParam,
				filePath: fileParam,
				includeCode: Type.Optional(Type.Boolean({ default: false })),
				symbolsOnly: Type.Optional(Type.Boolean({ default: false })),
				offset: offsetParam,
				limit: lineLimitParam,
				line: lineParam,
				depth: depthParam,
				trailLimit: trailLimitParam,
				projectPath: rootParam,
			}, strict),
			async execute(_id, params, signal, _update, ctx) {
				const root = rootFor(ctx, params.projectPath);
				await manager.start(root, { allowCreate: allowCreate(), signal });
				const payload = await manager.query("node", signal, async (graph) => {
					const fileHint = params.filePath ?? params.file;
					if (!params.symbol) {
						if (!fileHint) throw new Error("codegraph_node requires symbol or file/filePath");
						return filePayload(graph, root, fileHint, {
							offset: params.offset ?? 1,
							lineLimit: params.limit ?? 2000,
							symbolsOnly: params.symbolsOnly ?? false,
							signal,
						});
					}
					const candidates = resolveNodeCandidates(graph, root, params.symbol, fileHint, params.line);
					if (candidates.length === 0) return { status: "not_found", query: params.symbol };
					if (candidates.length === 1) {
						return { status: "resolved", ...(await nodePayload(graph, candidates[0]!, params.includeCode ?? false, params.depth ?? 1, params.trailLimit ?? 12, signal)) };
					}
					const definitions = candidates.slice(0, 20);
					const candidateSummary = candidates.slice(0, 25);
					return {
						status: "ambiguous",
						query: params.symbol,
						count: candidates.length,
						candidates: params.includeCode ? undefined : candidateSummary.map(compactNode),
						omittedCandidates: Math.max(0, candidates.length - candidateSummary.length),
						definitions: params.includeCode
							? await Promise.all(definitions.map((node) => nodePayload(graph, node, true, params.depth ?? 1, params.trailLimit ?? 12, signal)))
							: undefined,
						omittedDefinitions: Math.max(0, candidates.length - definitions.length),
					};
				});
				return result("codegraph_node", root, manager, payload);
			},
		});

		this.pi.registerTool({
			name: "codegraph_files",
			label: "CodeGraph Files",
			description: "Show the indexed project file tree with language and symbol counts. Faster and smaller than filesystem discovery.",
			promptSnippet: "Inspect indexed project layout without a broad filesystem scan",
			parameters: Type.Object({
				path: Type.Optional(Type.String({ minLength: 1, maxLength: 1000 })),
				pattern: Type.Optional(Type.String({ minLength: 1, maxLength: 500 })),
				format: fileFormatParam,
				includeMetadata: Type.Optional(Type.Boolean({ default: true })),
				maxDepth: Type.Optional(Type.Integer({ minimum: 0, maximum: 20 })),
				limit: fileLimitParam,
				projectPath: rootParam,
			}, strict),
			async execute(_id, params, signal, _update, ctx) {
				const root = rootFor(ctx, params.projectPath);
				await manager.start(root, { allowCreate: allowCreate(), signal });
				const payload = await manager.query("files", signal, (graph) => {
					let files = graph.getFiles().sort((left, right) => left.path.localeCompare(right.path));
					if (params.path) {
						const prefix = projectRelativePath(root, params.path).replace(/\/$/u, "");
						files = files.filter((file) => prefix === "." || file.path === prefix || file.path.startsWith(`${prefix}/`));
					}
					if (params.pattern) {
						const matcher = globRegex(params.pattern.replaceAll("\\", "/"));
						files = files.filter((file) => matcher.test(file.path));
					}
					const limit = params.limit ?? 200;
					const selectedFiles = files.slice(0, limit);
					const selected = selectedFiles.map((file) => compactFile(file, params.includeMetadata !== false));
					const format = params.format ?? "tree";
					if (format === "flat") return { format, total: files.length, shown: selected.length, truncated: files.length > selected.length, files: selected };
					if (format === "grouped") {
						const grouped = new Map<string, Record<string, unknown>[]>();
						for (let index = 0; index < selected.length; index += 1) {
							const language = selectedFiles[index]!.language;
							grouped.set(language, [...(grouped.get(language) ?? []), selected[index]!]);
						}
						return { format, total: files.length, shown: selected.length, truncated: files.length > selected.length, filesByLanguage: Object.fromEntries([...grouped.entries()].sort(([left], [right]) => left.localeCompare(right))) };
					}
					const treeFiles = params.maxDepth === undefined
						? selected
						: selected.filter((file) => String(file.path).split("/").length - 1 <= params.maxDepth!);
					return {
						format,
						total: files.length,
						shown: treeFiles.length,
						truncated: files.length > treeFiles.length,
						tree: fileTree(treeFiles, params.maxDepth),
					};
				});
				return result("codegraph_files", root, manager, payload);
			},
		});

		this.pi.registerTool({
			name: "codegraph_search",
			label: "CodeGraph Search",
			description: "Search indexed symbols by text with strict result limits. Scores are relative ranking signals, not percentages.",
			parameters: Type.Object({
				query: queryParam,
				projectPath: rootParam,
				limit: limitParam,
				kinds: Type.Optional(Type.Array(Type.String({ pattern: NODE_KIND_PATTERN }), { maxItems: 10, uniqueItems: true })),
			}, strict),
			async execute(_id, params, signal, _update, ctx) {
				const root = rootFor(ctx, params.projectPath);
				await manager.start(root, { allowCreate: allowCreate(), signal });
				const matches = await manager.query("search", signal, (graph) => graph.searchNodes(params.query, {
					limit: params.limit ?? 25,
					kinds: params.kinds as NodeKind[] | undefined,
				}));
				return result("codegraph_search", root, manager, {
					query: params.query,
					count: matches.length,
					results: matches.map((match) => ({ score: match.score, highlights: match.highlights, node: compactNode(match.node) })),
				});
			},
		});

		for (const direction of ["callers", "callees"] as const) {
			const tool = `codegraph_${direction}` as const;
			this.pi.registerTool({
				name: tool,
				label: `CodeGraph ${direction === "callers" ? "Callers" : "Callees"}`,
				description: `Resolve one symbol deterministically and return best-effort ${direction} from official CodeGraph call edges. Ambiguity is returned explicitly.`,
				parameters: Type.Object({
					symbol: symbolParam,
					filePath: fileParam,
					projectPath: rootParam,
					depth: depthParam,
					limit: limitParam,
					includeSource: Type.Optional(Type.Boolean({ default: false })),
				}, strict),
				async execute(_id, params, signal, _update, ctx) {
					const root = rootFor(ctx, params.projectPath);
					await manager.start(root, { allowCreate: allowCreate(), signal });
					const payload = await manager.query(direction, signal, async (graph) => {
						const resolution = resolveSymbol(graph, root, params.symbol, params.filePath);
						if (resolution.status !== "resolved") return resolution;
						const relationships = (direction === "callers"
							? graph.getCallers(resolution.node.id, params.depth ?? 1)
							: graph.getCallees(resolution.node.id, params.depth ?? 1)).slice(0, params.limit ?? 25);
						const nodes = [];
						for (const relationship of relationships) {
							nodes.push({
								node: await addSource(graph, relationship.node, params.includeSource ?? false, signal),
								edge: compactEdge(relationship.edge),
							});
						}
						return {
							status: "resolved",
							target: compactNode(resolution.node),
							bestEffort: true,
							caveat: "Call edges can omit dynamic dispatch and synthesized runtime relationships.",
							[direction]: nodes,
						};
					});
					return result(tool, root, manager, payload);
				},
			});
		}

		this.pi.registerTool({
			name: "codegraph_impact",
			label: "CodeGraph Impact",
			description: "Resolve one symbol and calculate a bounded best-effort impact radius, including affected files. Not a semantic rename reference set.",
			parameters: Type.Object({
				symbol: symbolParam,
				filePath: fileParam,
				projectPath: rootParam,
				depth: Type.Optional(Type.Integer({ minimum: 1, maximum: 5, default: 3 })),
				limit: limitParam,
			}, strict),
			async execute(_id, params, signal, _update, ctx) {
				const root = rootFor(ctx, params.projectPath);
				await manager.start(root, { allowCreate: allowCreate(), signal });
				const payload = await manager.query("impact", signal, (graph) => {
					const resolution = resolveSymbol(graph, root, params.symbol, params.filePath);
					if (resolution.status !== "resolved") return resolution;
					const impact = graph.getImpactRadius(resolution.node.id, params.depth ?? 3);
					const nodes = [...impact.nodes.values()].sort(compareNodes).slice(0, params.limit ?? 25);
					return {
						status: "resolved",
						target: compactNode(resolution.node),
						bestEffort: true,
						caveat: "Impact is graph-derived and incomplete for dynamic behavior. Do not use it alone for rename; compose a syntax-aware matcher with LSP/compiler checks.",
						affectedFiles: [...new Set(nodes.map((node) => node.filePath))].sort(),
						affectedNodes: nodes.map(compactNode),
						edges: impact.edges.slice(0, (params.limit ?? 25) * 4).map(compactEdge),
						truncated: impact.nodes.size > nodes.length,
					};
				});
				return result("codegraph_impact", root, manager, payload);
			},
		});

		for (const toolName of ["codegraph_stats", "codegraph_status"] as const) {
			this.pi.registerTool({
				name: toolName,
				label: toolName === "codegraph_status" ? "CodeGraph Status" : "CodeGraph Stats",
				description: "Report embedded CodeGraph readiness, graph counts, freshness, watcher health, and local profiling aggregates.",
				parameters: Type.Object({ projectPath: rootParam }, strict),
				async execute(_id, params, signal, _update, ctx) {
					const root = rootFor(ctx, params.projectPath);
					await manager.start(root, { allowCreate: allowCreate(), signal });
					const official = await manager.query("stats", signal, (graph) => ({
						stats: graph.getStats(),
						backend: graph.getBackend(),
						journalMode: graph.getJournalMode(),
						lastIndexedAt: graph.getLastIndexedAt(),
						indexState: graph.getIndexState(),
						indexStale: graph.isIndexStale(),
						pendingReferences: graph.getPendingReferenceCount(),
						frameworks: graph.getDetectedFrameworks(),
						changedFiles: graph.getChangedFiles(),
					}));
					return result(toolName, root, manager, {
						official,
						snapshot: manager.snapshot(),
						freshness: manager.freshness(),
						profile: manager.profileReport(),
					});
				},
			});
		}
	}

	setReady(ready: boolean): void {
		if (ready === this.active) return;
		this.active = ready;
		const owned = new Set<string>(OWNED_TOOL_NAMES);
		const others = this.pi.getActiveTools().filter((name) => !owned.has(name));
		this.pi.setActiveTools(ready ? [...new Set([...others, ...OWNED_TOOL_NAMES])] : others);
	}

}
