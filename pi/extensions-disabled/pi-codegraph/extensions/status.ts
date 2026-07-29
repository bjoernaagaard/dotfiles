import type { GraphSnapshot } from "./types.ts";

function duration(value: number | undefined): string | undefined {
	if (value === undefined) return undefined;
	return value < 10 ? `${value.toFixed(1)}ms` : `${Math.round(value)}ms`;
}

export function formatStatus(snapshot: GraphSnapshot, ascii = false): string | undefined {
	if (snapshot.kind === "idle" || snapshot.kind === "closed") return undefined;
	const separator = ascii ? " | " : "  ";
	const stats = snapshot.stats;
	const counts = stats ? `${stats.fileCount}f/${stats.nodeCount}n` : undefined;
	const freshness = snapshot.fresh
		? "fresh"
		: snapshot.pendingPaths.length > 0
			? `${snapshot.kind}:${snapshot.pendingPaths.length}`
			: snapshot.kind;
	const watch = snapshot.watcherDegraded ? "watch!" : snapshot.watching ? "watch" : undefined;
	return [ascii ? "CG" : "CG ◆", snapshot.kind, counts, freshness, watch, duration(snapshot.lastDurationMs)]
		.filter((value): value is string => Boolean(value))
		.join(separator);
}

export function formatStatusReport(snapshot: GraphSnapshot): string {
	const stats = snapshot.stats;
	return [
		`state: ${snapshot.kind}`,
		`root: ${snapshot.projectRoot ?? "none"}`,
		`fresh: ${snapshot.fresh ? "yes" : "no"}`,
		`pending: ${snapshot.pendingPaths.length}${snapshot.pendingPaths.length ? ` (${snapshot.pendingPaths.join(", ")})` : ""}`,
		`watch: ${snapshot.watching ? "on" : "off"}${snapshot.watcherDegraded ? " (degraded)" : ""}`,
		stats ? `graph: ${stats.fileCount} files, ${stats.nodeCount} nodes, ${stats.edgeCount} edges` : "graph: unavailable",
		`last: ${snapshot.lastOperation ?? "none"}${snapshot.lastDurationMs === undefined ? "" : ` in ${duration(snapshot.lastDurationMs)}`}`,
		`profile: ${snapshot.profileEnabled ? "on" : "off"}`,
		snapshot.message ? `message: ${snapshot.message}` : undefined,
	].filter((line): line is string => line !== undefined).join("\n");
}
