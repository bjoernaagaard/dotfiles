import { performance } from "node:perf_hooks";
import type { ProfileAggregate, ProfileReport } from "./types.ts";

interface MutableAggregate {
	count: number;
	failures: number;
	totalMs: number;
	minMs: number;
	maxMs: number;
	lastMs: number;
	outputBytes: number;
}

export class OperationProfiler {
	private enabledValue: boolean;
	private readonly operations = new Map<string, MutableAggregate>();

	constructor(enabled = false) {
		this.enabledValue = enabled;
	}

	get enabled(): boolean {
		return this.enabledValue;
	}

	setEnabled(enabled: boolean): void {
		this.enabledValue = enabled;
		if (!enabled) this.operations.clear();
	}

	start(): number | undefined {
		return this.enabledValue ? performance.now() : undefined;
	}

	record(name: string, startedAt: number | undefined, outputBytes = 0, failed = false): number | undefined {
		if (startedAt === undefined || !this.enabledValue) return undefined;
		const durationMs = performance.now() - startedAt;
		const key = this.operations.has(name) || this.operations.size < 63 ? name : "other";
		const current = this.operations.get(key);
		if (current) {
			current.count += 1;
			current.failures += failed ? 1 : 0;
			current.totalMs += durationMs;
			current.minMs = Math.min(current.minMs, durationMs);
			current.maxMs = Math.max(current.maxMs, durationMs);
			current.lastMs = durationMs;
			current.outputBytes += outputBytes;
		} else {
			this.operations.set(key, {
				count: 1,
				failures: failed ? 1 : 0,
				totalMs: durationMs,
				minMs: durationMs,
				maxMs: durationMs,
				lastMs: durationMs,
				outputBytes,
			});
		}
		return durationMs;
	}

	async measure<T>(name: string, operation: () => Promise<T> | T, outputSize?: (value: T) => number): Promise<T> {
		if (!this.enabledValue) return await operation();
		const startedAt = performance.now();
		let outputBytes = 0;
		let failed = false;
		try {
			const value = await operation();
			outputBytes = outputSize?.(value) ?? 0;
			return value;
		} catch (error) {
			failed = true;
			throw error;
		} finally {
			this.record(name, startedAt, outputBytes, failed);
		}
	}

	report(): ProfileReport {
		const operations: Record<string, ProfileAggregate> = {};
		for (const [name, value] of [...this.operations.entries()].sort(([left], [right]) => left.localeCompare(right))) {
			operations[name] = {
				...value,
				averageMs: value.count === 0 ? 0 : value.totalMs / value.count,
			};
		}
		return { enabled: this.enabledValue, operations };
	}

	clear(): void {
		this.operations.clear();
	}
}
