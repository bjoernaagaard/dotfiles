import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { createRuntime } from "../src/runtime.ts";
import { registerAuthor } from "../src/modules/author.ts";
import { registerOperate } from "../src/modules/operate.ts";
import { registerDiagnose } from "../src/modules/diagnose.ts";
import { applyCliFlags, registerUi, setStatusFromRuntime } from "../src/modules/ui.ts";
import { applySessionStartActiveTools, registerAllTools } from "../src/tools/register.ts";
import { createToolCallPolicyHandler } from "../src/policy/tool-call.ts";
import { createDagsterAutocompleteProvider } from "../src/ui/autocomplete.ts";
import { DAGSTER_CORE_GUIDANCE } from "../src/guidance.ts";

/**
 * Default composition root.
 * Factory only registers tools/commands/handlers — no sockets, processes, or timers.
 * GraphQL client / dg dev / WS are created lazily on first use or via commands.
 */
export default function (pi: ExtensionAPI): void {
  // Single explicit runtime for this extension instance (no process-global singleton).
  const runtime = createRuntime(pi);

  registerAuthor(pi, runtime);
  registerOperate(pi, runtime);
  registerDiagnose(pi, runtime);
  registerUi(pi, runtime);
  registerAllTools(pi, runtime);

  // Central policy gate for non-read tools (blocks only; confirm in execute).
  pi.on("tool_call", createToolCallPolicyHandler(runtime));

  pi.on("session_start", async (_event, ctx) => {
    runtime.setStatusSink(ctx.hasUI ? ctx.ui.setStatus.bind(ctx.ui) : undefined);

    // Fail-closed profile load: untrusted projects skip project-local file reads.
    const trusted = ctx.isProjectTrusted();
    try {
      await runtime.listProfiles(ctx.cwd, trusted);
    } catch {
      // Missing/invalid profiles are non-fatal at session start.
    }

    // CLI flags after profiles load.
    applyCliFlags(pi, runtime);

    // Reconstruct loaded tools + active profile from branch details, then set active tools.
    // Preserves foreign tools / builtins; only manages our searchable set.
    applySessionStartActiveTools(pi, runtime, ctx.sessionManager);

    setStatusFromRuntime(ctx, runtime);

    // Stack local @/# entity completions on top of built-in slash/path completion.
    // Cache-only — no network while typing.
    try {
      ctx.ui.addAutocompleteProvider((current) =>
        createDagsterAutocompleteProvider(current, () => runtime.getEntityReferences()),
      );
    } catch {
      // Non-TUI / older Pi without autocomplete stacking.
    }
  });

  pi.on("before_agent_start", async (event) => {
    const profile = runtime.activeProfileName ?? "none";
    const policy = runtime.getEffectivePolicy();
    const conn = runtime.getConnectionState();
    const connected = conn.connected ? "connected" : "not-connected";
    const dev = runtime.getDgDevState();
    const devNote =
      dev.status === "running"
        ? ` dg-dev=running:${dev.port ?? "?"}`
        : dev.status === "starting"
          ? " dg-dev=starting"
          : "";
    const watches = runtime.listWatches().length;
    const watchNote = watches > 0 ? ` watches=${watches}` : "";
    const note = [`Dagster: profile=${profile} policy=${policy} ${connected}${devNote}${watchNote}.`, DAGSTER_CORE_GUIDANCE].join(" ");
    // Chain onto the current system prompt (Pi chains handlers).
    return {
      systemPrompt: `${event.systemPrompt}\n\n${note}`,
    };
  });

  // Fail-closed: cancel session switch/fork while dg dev is active.
  // Watches are stopped in shutdown (session_shutdown); also stop on switch path via invalidate.
  pi.on("session_before_switch", async () => {
    const st = runtime.getDgDevState();
    if (st.status === "starting" || st.status === "running") {
      return {
        cancel: true,
        // Message surface depends on Pi UI; cancel is the fail-closed contract.
      };
    }
    // Stop watches when leaving session (minimum: clean WS/watch state).
    try {
      for (const w of runtime.listWatches()) {
        runtime.stopWatch(w.id);
      }
      runtime.invalidateWsClient();
    } catch {
      // ignore
    }
    return {};
  });

  pi.on("session_before_fork", async () => {
    const st = runtime.getDgDevState();
    if (st.status === "starting" || st.status === "running") {
      return { cancel: true };
    }
    return {};
  });

  pi.on("session_shutdown", (_event, ctx) => {
    try {
      ctx.ui.setStatus("dagster", undefined);
    } catch {
      // ignore
    }
    // Idempotent cleanup — stops dg dev, drops client + capability cache.
    runtime.shutdown();
  });
}
