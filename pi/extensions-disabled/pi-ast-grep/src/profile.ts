import { performance } from "node:perf_hooks";

export interface PhaseMetric {
  readonly phase: string;
  readonly count: number;
  readonly totalMs: number;
  readonly minMs: number;
  readonly maxMs: number;
  readonly averageMs: number;
}

interface MutableMetric {
  count: number;
  totalMs: number;
  minMs: number;
  maxMs: number;
}

/**
 * Explicit, local-only development profiler. It uses perf_hooks marks/measures
 * and is never constructed unless file/Pi configuration enables profiling.
 */
export class PhaseProfiler {
  readonly #metrics = new Map<string, MutableMetric>();
  #sequence = 0;

  async measure<T>(phase: string, operation: () => Promise<T>): Promise<T> {
    const id = `pi-ast-grep:${this.#sequence++}:${phase}`;
    const start = `${id}:start`;
    const end = `${id}:end`;
    performance.mark(start);
    try {
      return await operation();
    } finally {
      performance.mark(end);
      const entry = performance.measure(id, start, end);
      this.#record(phase, entry.duration);
      performance.clearMarks(start);
      performance.clearMarks(end);
      performance.clearMeasures(id);
    }
  }

  measureSync<T>(phase: string, operation: () => T): T {
    const id = `pi-ast-grep:${this.#sequence++}:${phase}`;
    const start = `${id}:start`;
    const end = `${id}:end`;
    performance.mark(start);
    try {
      return operation();
    } finally {
      performance.mark(end);
      const entry = performance.measure(id, start, end);
      this.#record(phase, entry.duration);
      performance.clearMarks(start);
      performance.clearMarks(end);
      performance.clearMeasures(id);
    }
  }

  report(): readonly PhaseMetric[] {
    return [...this.#metrics.entries()]
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([phase, metric]) => ({
        phase,
        count: metric.count,
        totalMs: metric.totalMs,
        minMs: metric.minMs,
        maxMs: metric.maxMs,
        averageMs: metric.totalMs / metric.count,
      }));
  }

  clear(): void {
    this.#metrics.clear();
  }

  #record(phase: string, durationMs: number): void {
    const current = this.#metrics.get(phase);
    if (current === undefined) {
      this.#metrics.set(phase, { count: 1, totalMs: durationMs, minMs: durationMs, maxMs: durationMs });
      return;
    }
    current.count += 1;
    current.totalMs += durationMs;
    current.minMs = Math.min(current.minMs, durationMs);
    current.maxMs = Math.max(current.maxMs, durationMs);
  }
}
