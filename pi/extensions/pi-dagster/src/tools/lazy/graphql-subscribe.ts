import { defineTool } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { appendFile, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import type { DagsterRuntime } from "../../runtime.ts";
import {
  GraphqlOperationError,
  selectGraphqlOperation,
} from "../../graphql/operation.ts";
import { assertRuntimeOpen, redactedJsonResult } from "./mutation-helpers.ts";
import { redactObject } from "../../policy/redact.ts";
import { attachSafeRenderers } from "../../render/index.ts";

export type SubscriptionCompletionReason =
  | "completed"
  | "max_events"
  | "timeout"
  | "aborted"
  | "error";

/**
 * Deterministic, abort-safe subscription collector.
 * Resolves exactly once; stop() / timer / parent listener cleaned on all paths.
 * onError rejects the promise (never throws from the async callback).
 */
export async function collectGraphqlSubscription(opts: {
  subscribe: (handlers: {
    onNext: (data: unknown) => void;
    onError: (err: Error) => void;
    onComplete: () => void;
  }) => Promise<{ stop: () => void }>;
  parentSignal?: AbortSignal;
  /** Hard total event cap before auto-stop. */
  maxEvents: number;
  /** Number retained inline; remaining events (up to maxEvents) spill redacted. */
  inlineEvents?: number;
  timeoutMs: number;
  redact: (data: unknown) => unknown;
  /** Awaited overflow writer; returns path. Called only after inline cap. */
  writeOverflowLine?: (line: string) => Promise<string>;
}): Promise<{
  events: unknown[];
  eventCount: number;
  completionReason: SubscriptionCompletionReason;
  overflowPath?: string;
}> {
  const events: unknown[] = [];
  const inlineLimit = Math.min(
    Math.max(opts.inlineEvents ?? opts.maxEvents, 0),
    opts.maxEvents,
  );
  let eventCount = 0;
  let overflowPath: string | undefined;
  let completionReason: SubscriptionCompletionReason | null = null;
  let rejectError: Error | null = null;
  let stopFn: (() => void) | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let parentListener: (() => void) | null = null;
  let overflowQueue: Promise<void> = Promise.resolve();
  let settleWait: (() => void) | null = null;

  const cleanup = () => {
    if (timer) {
      clearTimeout(timer);
      timer = null;
    }
    if (opts.parentSignal && parentListener) {
      opts.parentSignal.removeEventListener("abort", parentListener);
      parentListener = null;
    }
    if (stopFn) {
      try {
        stopFn();
      } catch {
        // ignore
      }
      stopFn = null;
    }
  };

  const finish = (reason: SubscriptionCompletionReason) => {
    if (completionReason) return;
    completionReason = reason;
    cleanup();
    settleWait?.();
  };

  try {
    if (opts.parentSignal?.aborted) {
      const err = new Error("Aborted");
      err.name = "AbortError";
      throw err;
    }

    const waitDone = new Promise<void>((resolve) => {
      settleWait = resolve;
    });

    parentListener = () => finish("aborted");
    if (opts.parentSignal) {
      opts.parentSignal.addEventListener("abort", parentListener, { once: true });
    }

    timer = setTimeout(() => finish("timeout"), opts.timeoutMs);

    const sub = await opts.subscribe({
      onNext: (data) => {
        if (completionReason || eventCount >= opts.maxEvents) return;
        const redacted = opts.redact(data);
        eventCount += 1;
        if (events.length < inlineLimit) {
          events.push(redacted);
        } else if (opts.writeOverflowLine) {
          // Beyond inline cap: serialize redacted data through one awaited queue.
          overflowQueue = overflowQueue.then(async () => {
            overflowPath = await opts.writeOverflowLine!(
              `${JSON.stringify(redacted)}\n`,
            );
          });
        }
        if (eventCount >= opts.maxEvents) {
          finish("max_events");
        }
      },
      onError: (err) => {
        rejectError = err instanceof Error ? err : new Error(String(err));
        finish("error");
      },
      onComplete: () => {
        finish("completed");
      },
    });
    stopFn = () => {
      try {
        sub.stop();
      } catch {
        // ignore
      }
    };

    // If finish already happened during subscribe setup, settleWait may have run.
    if (!completionReason) {
      await waitDone;
    }
    await overflowQueue;
  } finally {
    cleanup();
  }

  if (completionReason === "aborted") {
    const err = new Error("Aborted");
    err.name = "AbortError";
    throw err;
  }
  if (completionReason === "error") {
    throw rejectError ?? new Error("Subscription error");
  }

  return {
    events,
    eventCount,
    completionReason: completionReason ?? "completed",
    overflowPath,
  };
}

export function createGraphqlSubscribeTool(runtime: DagsterRuntime) {
  return attachSafeRenderers(
    defineTool({
      name: "dagster_graphql_subscribe",
      label: "GraphQL Subscribe",
      description:
        "Generic GraphQL subscription escape hatch. Collects events until maxEvents/timeout/abort (read risk).",
      parameters: Type.Object({
        subscription: Type.String(),
        variables: Type.Optional(Type.Record(Type.String(), Type.Unknown())),
        operationName: Type.Optional(Type.String()),
        maxEvents: Type.Optional(Type.Number()),
        timeoutMs: Type.Optional(Type.Number()),
      }),
      async execute(_toolCallId, params, signal, _onUpdate, ctx) {
        assertRuntimeOpen(runtime, signal);
        const subscription = params.subscription.trim();
        if (!subscription) throw new Error("subscription document is required");

        let selected;
        try {
          selected = selectGraphqlOperation({
            document: subscription,
            operationName: params.operationName,
            expectedType: "subscription",
          });
        } catch (err) {
          const msg =
            err instanceof GraphqlOperationError || err instanceof Error
              ? err.message
              : String(err);
          throw new Error(
            `dagster_graphql_subscribe: ${msg}. Use dagster_graphql_query for queries; dagster_graphql_mutation for mutations.`,
          );
        }

        const maxEvents = Math.min(Math.max(params.maxEvents ?? 50, 1), 500);
        const timeoutMs = Math.min(Math.max(params.timeoutMs ?? 30_000, 100), 300_000);
        const parent = signal ?? ctx?.signal;
        const extra = runtime.getActiveProfile()?.redaction?.extraKeyPatterns;
        const redact = (data: unknown) => redactObject(data, extra);

        const ws = await runtime.ensureWsClient({ signal: parent });

        let overflowPath: string | undefined;
        const writeOverflowLine = async (line: string): Promise<string> => {
          if (!overflowPath) {
            const dir = join(tmpdir(), `pi-dagster-sub-${randomUUID()}`);
            await mkdir(dir, { recursive: true, mode: 0o700 });
            overflowPath = join(dir, "events.jsonl");
            await writeFile(overflowPath, "", { encoding: "utf8", mode: 0o600 });
          }
          await appendFile(overflowPath, line, { encoding: "utf8", mode: 0o600 });
          return overflowPath;
        };

        const collected = await collectGraphqlSubscription({
          maxEvents,
          inlineEvents: Math.min(maxEvents, 50),
          timeoutMs,
          parentSignal: parent,
          redact,
          writeOverflowLine,
          subscribe: async (handlers) => {
            return ws.subscribe<unknown>({
              query: subscription,
              variables: params.variables,
              operationName: params.operationName ?? selected.name,
              signal: parent,
              onNext: (data) => handlers.onNext(data),
              onError: (err) => handlers.onError(err),
              onComplete: () => handlers.onComplete(),
            });
          },
        });

        const payload = {
          eventCount: collected.eventCount,
          maxEvents,
          timeoutMs,
          completionReason: collected.completionReason,
          overflowPath: collected.overflowPath,
          events: collected.events,
        };
        const result = await redactedJsonResult(runtime, payload, "graphql-subscribe");
        return {
          ...result,
          details: {
            ...result.details,
            kind: "subscription",
            eventCount: collected.eventCount,
            completionReason: collected.completionReason,
            overflowPath: collected.overflowPath,
            endpoint: ws.url,
            operationType: selected.type,
            operationName: selected.name,
            rootFields: selected.rootFields,
          },
        };
      },
    }),
  );
}
