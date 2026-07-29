# Performance

Measure before changing code. Define the workload, latency or throughput target, environment, and correctness invariant.

1. Reproduce the representative workload.
2. Profile to locate CPU, allocation, I/O, or contention bottlenecks.
3. Change the highest-impact cause.
4. Benchmark before and after with variance and warmup controlled.
5. Retain a regression test or benchmark when the gain matters.

Use `timeit` or a benchmark framework for microbenchmarks, `cProfile` for deterministic call profiling, sampling profilers such as py-spy for lower-overhead production investigation, and allocation tools such as `tracemalloc` for Python memory. Tool suitability depends on native extensions, threads, subprocesses, and deployment permissions.

Prefer algorithmic and I/O improvements before syntax-level tuning. Sets and dictionaries provide average constant-time membership/lookup, not a universal replacement for sequences. Built-ins are often optimized but must still be measured on the actual workload. Generators reduce retained memory when data can be consumed incrementally; they don't inherently make execution faster.

Cache only pure or safely keyed computations. Bound caches and include configuration/tenant inputs in keys. Batch I/O within service limits, reuse pools, and avoid unbounded concurrency. Threads suit blocking I/O; processes or native code may help CPU work, subject to serialization and startup costs.

Profile production safely, redact captured data, and monitor tail latency and memory as well as averages. Reject changes whose complexity isn't justified by measured benefit.
