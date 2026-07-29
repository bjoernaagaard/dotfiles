import type { ExtensionAPI, ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import type { DagsterRuntime } from "../runtime.ts";
import { ALWAYS_ON_NAMES, LAZY_TOOL_NAMES } from "../tools/catalog.ts";
import { resetToAlwaysOn } from "../tools/register.ts";
import { saveProfiles, type Profile, type ProfilesFile } from "../state/profiles.ts";
import type { ProfilePolicy } from "../policy/types.ts";
import { capabilitiesCacheAgeMs } from "../clients/capabilities.ts";
import { assertAllowed } from "../policy/risk.ts";
import { launchRunCore } from "../tools/lazy/launch-run.ts";
import { INSPECT_RUN_QUERY } from "../clients/documents/run.gql.ts";
import { formatRunSummary, mapRunOrError } from "../domain/run.ts";
import { formatWatchStatus } from "../domain/watches.ts";
import { handleIncidentCommand } from "./diagnose.ts";
import { handleDagsterSearchCommand } from "../ui/search-overlay.ts";
import {
  completeFromEntities,
  filterPrefix,
} from "../ui/autocomplete.ts";

/**
 * UI module: help, connect, target, status, tools reset, dg dev, launch, run.
 * Does not call setFooter / setEditorComponent or override built-ins.
 */
export function registerUi(pi: ExtensionAPI, runtime: DagsterRuntime): void {
  registerFlags(pi, runtime);

  pi.registerCommand("dagster", {
    description: "Dagster workflow help: establish target, search/load tools, inspect, then operate or diagnose under policy",
    handler: async (_args, ctx) => {
      const dev = runtime.getDgDevState();
      const watches = runtime.listWatches();
      const lines = [
        "pi-dagster Phase 5 (core polish + diagnose + operate + author)",
        "",
        `Active profile: ${runtime.activeProfileName ?? "(none)"}`,
        `Policy: ${runtime.getEffectivePolicy()}`,
        `Loaded lazy tools: ${runtime.getLoadedLazyTools().join(", ") || "(none)"}`,
        `Watches: ${watches.length}`,
        `Trusted: ${ctx.isProjectTrusted()}`,
        `Profile path: ${runtime.getProfilePath(ctx.cwd)}`,
        `dg dev: ${dev.status}${dev.port != null ? ` :${dev.port}` : ""}`,
        "",
        "Always-on tools:",
        ...ALWAYS_ON_NAMES.map((n) => `  - ${n}`),
        "",
        "Searchable (load via dagster_search_tools):",
        ...LAZY_TOOL_NAMES.map((n) => `  - ${n}`),
        "",
        "Commands:",
        "  /dagster                 this help",
        "  /dagster-connect         create/activate a GraphQL profile",
        "  /dagster-target [name]   list or switch active profile",
        "  /dagster-status          health + permissions summary",
        "  /dagster-search <query>  read-only catalog search (TUI overlay)",
        "  /dagster-dev [status|start|stop]",
        "  /dagster-launch job=… | assets=a,b/c [force=true]",
        "  /dagster-run <runId> | watch <runId> | unwatch | watches",
        "  /dagster-incident <runId> [hypothesis=…] | show | fork | clear",
        "  /dagster-tools [list|reset]",
        "",
        "Workflow guardrails: target status first; try dagster_search_tools before declaring a gap; prefer typed tools; evidence → strict baseline comparison → dg check → policy-gated relaunch; watches report log paths, not full streams.",
        "Autocomplete: @asset / @job:name / #runId (local cache only)",
        "Flags: --dagster-profile <name>  --dagster-read-only  --dagster-graphql <url>",
      ];
      await ctx.ui.notify(lines.join("\n"), "info");
    },
  });

  pi.registerCommand("dagster-tools", {
    description: "List or reset dynamically loaded Dagster tools",
    getArgumentCompletions: async (prefix) => {
      const options = ["list", "reset"];
      return options
        .filter((o) => o.startsWith(prefix.trim()))
        .map((value) => ({ value, label: value }));
    },
    handler: async (args, ctx) => {
      const sub = args.trim().split(/\s+/)[0] ?? "list";
      if (sub === "reset") {
        const next = resetToAlwaysOn(pi, runtime);
        await ctx.ui.notify(
          `Reset Dagster active tools to always-on (${next.filter((n) => n.startsWith("dagster_")).join(", ")})`,
          "info",
        );
        return;
      }

      const active = pi.getActiveTools().filter((n) => n.startsWith("dagster_"));
      const loaded = runtime.getLoadedLazyTools();
      await ctx.ui.notify(
        [
          `Active Dagster tools: ${active.join(", ") || "(none)"}`,
          `Loaded via search (session): ${loaded.join(", ") || "(none)"}`,
          `Searchable catalog: ${LAZY_TOOL_NAMES.join(", ")}`,
        ].join("\n"),
        "info",
      );
    },
  });

  pi.registerCommand("dagster-connect", {
    description: "Create or update a Dagster GraphQL connection profile",
    handler: async (args, ctx) => {
      await handleConnect(args, ctx, runtime);
    },
  });

  pi.registerCommand("dagster-target", {
    description: "List or switch active Dagster profile",
    getArgumentCompletions: async (prefix) => {
      const p = prefix.trim().toLowerCase();
      return runtime.profiles
        .map((x) => x.name)
        .filter((n) => n.toLowerCase().startsWith(p))
        .map((value) => ({ value, label: value }));
    },
    handler: async (args, ctx) => {
      await handleTarget(args, ctx, runtime);
    },
  });

  pi.registerCommand("dagster-status", {
    description: "Show Dagster target connection health, permissions, location load, and capabilities",
    handler: async (_args, ctx) => {
      await handleStatus(ctx, runtime);
    },
  });

  pi.registerCommand("dagster-dev", {
    description: "Local dg dev lifecycle (not dagster_dg_command): status | start | stop; check source with dg check first",
    getArgumentCompletions: async (prefix) => {
      const options = ["status", "start", "stop"];
      const p = prefix.trim().toLowerCase();
      return options
        .filter((o) => o.startsWith(p))
        .map((value) => ({ value, label: value }));
    },
    handler: async (args, ctx) => {
      await handleDev(args, ctx, runtime);
    },
  });

  pi.registerCommand("dagster-launch", {
    description: "Policy-gated guided run launch; inspect target first. Usage: job=… or assets=… [force=true]",
    getArgumentCompletions: async (prefix) => {
      const p = prefix.trim();
      const templates = ["job=", "assets=", "force=true", "location=", "repo="];
      const fromCache = completeFromEntities(
        runtime.getEntityReferences(),
        ["job", "asset"],
        p.replace(/^(job=|assets=)/, ""),
        (ref) =>
          ref.kind === "job" ? `job=${ref.id}` : `assets=${ref.id}`,
      );
      const staticHits = filterPrefix(templates, p);
      return [...fromCache, ...staticHits].slice(0, 20);
    },
    handler: async (args, ctx) => {
      await handleLaunch(args, ctx, runtime);
    },
  });

  pi.registerCommand("dagster-run", {
    description: "Inspect before action or watch a run: <runId> | watch <runId> | unwatch | watches; use log paths, not full streams",
    getArgumentCompletions: async (prefix) => {
      const parts = prefix.trim().split(/\s+/);
      const head = parts[0]?.toLowerCase() ?? "";
      if (!head || ["watch", "unwatch", "watches"].some((x) => x.startsWith(head))) {
        const actions = filterPrefix(["watch", "unwatch", "watches"], head);
        const runs = completeFromEntities(
          runtime.getEntityReferences(),
          ["run"],
          head,
          (r) => r.id,
        );
        return [...actions, ...runs].slice(0, 20);
      }
      if (head === "watch" || head === "unwatch") {
        const rest = parts.slice(1).join(" ");
        const runs = completeFromEntities(
          runtime.getEntityReferences(),
          ["run", "watch"],
          rest,
          (r) => r.id,
        );
        const watches = runtime.listWatches().map((w) => ({
          value: w.id,
          label: w.id,
          description: w.runId,
        }));
        return [...runs, ...watches].slice(0, 20);
      }
      return completeFromEntities(
        runtime.getEntityReferences(),
        ["run"],
        prefix.trim(),
        (r) => r.id,
      );
    },
    handler: async (args, ctx) => {
      await handleRun(args, ctx, runtime);
    },
  });

  pi.registerCommand("dagster-incident", {
    description: "Diagnose with bounded evidence then strict baseline comparison; record/show/clear or fork one explicit hypothesis",
    getArgumentCompletions: async (prefix) => {
      const p = prefix.trim().toLowerCase();
      const actions = filterPrefix(["show", "clear", "fork"], p);
      const runs = completeFromEntities(
        runtime.getEntityReferences(),
        ["run"],
        p,
        (r) => r.id,
      );
      return [...actions, ...runs].slice(0, 20);
    },
    handler: async (args, ctx) => {
      await handleIncidentCommand(args, ctx, runtime);
    },
  });

  pi.registerCommand("dagster-search", {
    description: "Read-only cross-entity search (TUI overlay picker; text fallback)",
    getArgumentCompletions: async (prefix) => {
      const templates = ["asset", "job", "run", "schedule", "sensor"];
      return filterPrefix(templates, prefix.trim());
    },
    handler: async (args, ctx) => {
      await handleDagsterSearchCommand(args, ctx, runtime);
    },
  });
}

function registerFlags(pi: ExtensionAPI, _runtime: DagsterRuntime): void {
  pi.registerFlag("dagster-profile", {
    description: "Activate Dagster profile by name at session start",
    type: "string",
  });
  pi.registerFlag("dagster-read-only", {
    description: "Force read-only policy for this session",
    type: "boolean",
    default: false,
  });
  pi.registerFlag("dagster-graphql", {
    description: "Ephemeral GraphQL HTTP URL override for this session",
    type: "string",
  });
}

/** Apply CLI flags after profiles load (called from core session_start). */
export function applyCliFlags(pi: ExtensionAPI, runtime: DagsterRuntime): void {
  const profileFlag = pi.getFlag("dagster-profile");
  if (typeof profileFlag === "string" && profileFlag.trim()) {
    try {
      runtime.setActiveProfile(profileFlag.trim());
    } catch (err) {
      // Unknown profile — leave unset; status will show none.
      void err;
    }
  }

  const readOnly = pi.getFlag("dagster-read-only");
  if (readOnly === true) {
    runtime.setEphemeralReadOnly(true);
  }

  const graphql = pi.getFlag("dagster-graphql");
  if (typeof graphql === "string" && graphql.trim()) {
    runtime.setEphemeralGraphqlUrl(graphql.trim());
  }
}

export function setStatusFromRuntime(
  ctx: { ui: { setStatus(key: string, text: string | undefined): void } },
  runtime: DagsterRuntime,
): void {
  if (runtime.closed) {
    ctx.ui.setStatus("dagster", undefined);
    return;
  }
  const name = runtime.activeProfileName ?? "none";
  const conn = runtime.getConnectionState();
  const caps = runtime.getCachedCapabilities();
  const errors =
    conn.lastErrorKind || (caps && caps.locationErrorCount > 0) ? " ⚠" : "";
  const dev = runtime.getDgDevState();
  let devSuffix = "";
  if (dev.status === "running" && dev.port != null) {
    devSuffix = ` dev:${dev.port}`;
  } else if (dev.status === "starting") {
    devSuffix = " ★dev";
  } else if (dev.status === "error") {
    devSuffix = " dev⚠";
  }
  const watches = runtime.listWatches().length;
  const watchSuffix = watches > 0 ? ` w:${watches}` : "";
  ctx.ui.setStatus("dagster", `dagster:${name}${devSuffix}${watchSuffix}${errors}`);
}

async function handleConnect(
  args: string,
  ctx: ExtensionCommandContext,
  runtime: DagsterRuntime,
): Promise<void> {
  const parsed = parseKvArgs(args);
  const hasUI = ctx.hasUI;
  const trusted = ctx.isProjectTrusted();

  let name: string | undefined = parsed.name;
  let graphqlHttp: string | undefined = parsed.graphqlHttp ?? parsed.url;
  let browserUrl: string | undefined = parsed.browserUrl;
  let projectRoot: string | undefined = parsed.projectRoot;
  let policy: ProfilePolicy | undefined = (parsed.policy as ProfilePolicy | undefined) ?? undefined;

  if (!hasUI) {
    // Non-UI: require args, fail-closed (no hanging prompts).
    if (!name || !graphqlHttp) {
      await ctx.ui.notify(
        "Usage (non-interactive): /dagster-connect name=local-dev graphqlHttp=http://localhost:3000/graphql [policy=readOnly|confirmMutations|allowMutations] [browserUrl=...] [projectRoot=...]",
        "error",
      );
      return;
    }
  } else {
    if (!name) {
      name =
        (await ctx.ui.input("Profile name", "local-dev"))?.trim() || "local-dev";
    }
    if (!graphqlHttp) {
      graphqlHttp =
        (
          await ctx.ui.input(
            "GraphQL HTTP URL",
            "http://localhost:3000/graphql",
          )
        )?.trim() || "http://localhost:3000/graphql";
    }
    if (browserUrl === undefined) {
      const entered = (await ctx.ui.input("Browser (Dagit) URL (optional)", ""))?.trim();
      browserUrl = entered || undefined;
    }
    if (projectRoot === undefined) {
      const entered = (await ctx.ui.input("Project root (optional)", ctx.cwd))?.trim();
      projectRoot = entered || undefined;
    }
    if (!policy) {
      const selected = await ctx.ui.select("Policy", [
        "readOnly",
        "confirmMutations",
        "allowMutations",
      ]);
      policy = (selected as ProfilePolicy | undefined) ?? "confirmMutations";
    }
  }

  const profile: Profile = {
    name: name!,
    graphqlHttp: graphqlHttp!,
    browserUrl: browserUrl || undefined,
    projectRoot: projectRoot || undefined,
    policy: policy ?? "confirmMutations",
  };

  runtime.upsertProfile(profile);

  if (trusted) {
    try {
      const existing = await runtime.listProfiles(ctx.cwd, true);
      const profiles = [...existing.filter((p) => p.name !== profile.name), profile];
      const file: ProfilesFile = { profiles, active: profile.name };
      await saveProfiles(ctx.cwd, true, file);
      // Refresh memory from disk + keep session state
      await runtime.listProfiles(ctx.cwd, true);
    } catch (err) {
      await ctx.ui.notify(
        `Profile kept session-only (save failed): ${err instanceof Error ? err.message : String(err)}`,
        "warning",
      );
    }
  } else {
    await ctx.ui.notify(
      "Project not trusted — profile is session-only (not written to disk).",
      "warning",
    );
  }

  runtime.setActiveProfile(profile.name);
  runtime.invalidateClient();

  try {
    const caps = await runtime.getCapabilities(true, ctx.signal);
    setStatusFromRuntime(ctx, runtime);
    if (caps) {
      await ctx.ui.notify(
        [
          `Connected profile "${profile.name}"`,
          `endpoint: ${caps.endpoint}`,
          `version: ${caps.version}`,
          `locations: ${caps.locations.map((l) => `${l.name}=${l.loadStatus}`).join(", ") || "(none)"}`,
          trusted ? "saved: yes" : "saved: session-only",
        ].join("\n"),
        "info",
      );
    } else {
      const conn = runtime.getConnectionState();
      await ctx.ui.notify(
        `Profile "${profile.name}" active but probe failed: ${conn.lastErrorMessage ?? conn.lastErrorKind ?? "unknown"}`,
        "warning",
      );
    }
  } catch (err) {
    setStatusFromRuntime(ctx, runtime);
    await ctx.ui.notify(
      `Profile "${profile.name}" set; capabilities probe error: ${err instanceof Error ? err.message : String(err)}`,
      "warning",
    );
  }
}

async function handleTarget(
  args: string,
  ctx: ExtensionCommandContext,
  runtime: DagsterRuntime,
): Promise<void> {
  const name = args.trim();
  if (!name) {
    const lines = runtime.profiles.length
      ? runtime.profiles.map((p) => {
          const mark = p.name === runtime.activeProfileName ? "*" : " ";
          return `${mark} ${p.name}  ${p.graphqlHttp ?? "(no url)"}  policy=${p.policy ?? "default"}`;
        })
      : ["(no profiles loaded)"];
    lines.unshift(`Active: ${runtime.activeProfileName ?? "(none)"}`);
    if (runtime.getEphemeralGraphqlUrl()) {
      lines.push(`Ephemeral GraphQL override: ${runtime.getEphemeralGraphqlUrl()}`);
    }
    await ctx.ui.notify(lines.join("\n"), "info");
    return;
  }

  try {
    runtime.setActiveProfile(name);
  } catch (err) {
    await ctx.ui.notify(err instanceof Error ? err.message : String(err), "error");
    return;
  }

  runtime.invalidateClient();
  try {
    await runtime.getCapabilities(true, ctx.signal);
  } catch {
    // connection state updated
  }
  setStatusFromRuntime(ctx, runtime);
  await ctx.ui.notify(`Active Dagster profile: ${name}`, "info");
}

async function handleStatus(
  ctx: ExtensionCommandContext,
  runtime: DagsterRuntime,
): Promise<void> {
  const trusted = ctx.isProjectTrusted();
  const profile = runtime.getActiveProfilePublic();
  const policy = runtime.getEffectivePolicy();

  let caps = runtime.getCachedCapabilities();
  if (runtime.activeProfileName || runtime.getEphemeralGraphqlUrl()) {
    try {
      caps = (await runtime.getCapabilities(false, ctx.signal)) ?? caps;
    } catch {
      // connection state updated
    }
  }

  const conn = runtime.getConnectionState();
  const endpoint =
    runtime.getEphemeralGraphqlUrl() ?? profile?.graphqlHttp ?? "(unset)";

  const dgDev = runtime.getDgDevState();
  const lines = [
    `activeProfile: ${runtime.activeProfileName ?? "(none)"}`,
    `trusted: ${trusted}`,
    `policy: ${policy}`,
    `ephemeralReadOnly: ${runtime.getEphemeralReadOnly()}`,
    `endpoint: ${endpoint}`,
    `connected: ${conn.connected}`,
    conn.lastVersion ? `version: ${conn.lastVersion}` : caps ? `version: ${caps.version}` : null,
    conn.lastErrorKind
      ? `lastError: ${conn.lastErrorKind} — ${conn.lastErrorMessage ?? ""}`
      : null,
    caps
      ? `canBulkTerminate: ${caps.canBulkTerminate}`
      : null,
    caps
      ? `permissions: ${caps.permissions.filter((p) => p.value).length}/${caps.permissions.length} allowed`
      : null,
    caps
      ? `locations: ${caps.locations.map((l) => `${l.name}=${l.loadStatus}${l.error ? "!" : ""}`).join(", ") || "(none)"}`
      : null,
    caps ? `locationErrorCount: ${caps.locationErrorCount}` : null,
    caps ? `cacheAgeMs: ${capabilitiesCacheAgeMs(caps)}` : null,
    `dgDev: ${dgDev.status}${dgDev.port != null ? ` port=${dgDev.port}` : ""}${dgDev.graphqlUrl ? ` ${dgDev.graphqlUrl}` : ""}`,
    `loadedTools: ${runtime.getLoadedLazyTools().join(", ") || "(none)"}`,
  ].filter(Boolean) as string[];

  setStatusFromRuntime(ctx, runtime);
  await ctx.ui.notify(lines.join("\n"), "info");
}

async function handleDev(
  args: string,
  ctx: ExtensionCommandContext,
  runtime: DagsterRuntime,
): Promise<void> {
  const tokens = args.trim().split(/\s+/).filter(Boolean);
  const sub = (tokens[0] ?? "status").toLowerCase();
  const rest = tokens.slice(1).join(" ");
  const kv = parseKvArgs(rest);

  if (sub === "status" || sub === "") {
    const st = runtime.getDgDevState();
    const lines = [
      `status: ${st.status}`,
      st.pid != null ? `pid: ${st.pid}` : null,
      st.host ? `host: ${st.host}` : null,
      st.port != null ? `port: ${st.port}` : null,
      st.graphqlUrl ? `graphqlUrl: ${st.graphqlUrl}` : null,
      st.projectRoot ? `projectRoot: ${st.projectRoot}` : null,
      st.logPath ? `logPath: ${st.logPath}` : null,
      st.startedAt ? `startedAt: ${new Date(st.startedAt).toISOString()}` : null,
      st.lastError ? `lastError: ${st.lastError}` : null,
    ].filter(Boolean) as string[];
    setStatusFromRuntime(ctx, runtime);
    await ctx.ui.notify(lines.join("\n"), "info");
    return;
  }

  if (sub === "stop") {
    if (runtime.getEphemeralReadOnly() || runtime.getEffectivePolicy() === "readOnly") {
      // Allow stop under readOnly? Brief: "still block under readOnly" for stop.
      await ctx.ui.notify("Blocked: readOnly policy — cannot manage dg dev", "error");
      return;
    }
    const st = await runtime.stopDgDev({ signal: ctx.signal });
    setStatusFromRuntime(ctx, runtime);
    await ctx.ui.notify(`dg dev stopped (status=${st.status})`, "info");
    return;
  }

  if (sub === "start") {
    const policy = runtime.getEffectivePolicy();
    const hasUI = ctx.hasUI;
    const decision = assertAllowed({
      risk: "local_exec",
      policy,
      hasUI,
      force: kv.force === "true" || kv.force === "1",
    });
    if (decision === "block") {
      await ctx.ui.notify(
        `Blocked by policy: risk=local_exec policy=${policy}` +
          (hasUI ? "" : " (non-UI: pass force=true)"),
        "error",
      );
      return;
    }
    if (decision === "confirm") {
      // First start in TUI under confirmMutations: confirm once per session.
      if (!runtime.wasDevStartConfirmed()) {
        if (!ctx.ui.confirm) {
          await ctx.ui.notify("Confirmation required to start dg dev", "error");
          return;
        }
        const ok = await ctx.ui.confirm(
          "Start dg dev",
          "Start a local dg dev webserver? (local_exec)",
        );
        if (!ok) {
          await ctx.ui.notify("dg dev start cancelled", "warning");
          return;
        }
        runtime.markDevStartConfirmed();
      }
    }

    let host = kv.host ?? "127.0.0.1";
    let port = kv.port ? Number(kv.port) : 3000;
    let cwd = kv.cwd;

    if (hasUI && !kv.port && tokens.length <= 1) {
      // Optional prompts only when interactive and no flags given.
      const hostIn = (await ctx.ui.input("Host", host))?.trim();
      if (hostIn) host = hostIn;
      const portIn = (await ctx.ui.input("Port", String(port)))?.trim();
      if (portIn && Number.isFinite(Number(portIn))) port = Number(portIn);
      const cwdIn = (await ctx.ui.input("Project cwd", ctx.cwd))?.trim();
      if (cwdIn) cwd = cwdIn;
    }

    if (!Number.isFinite(port) || port <= 0) {
      await ctx.ui.notify(`Invalid port: ${kv.port}`, "error");
      return;
    }

    const projectCwd = cwd?.trim() || (await runtime.getProjectRoot(ctx.cwd));
    await ctx.ui.notify(`Starting dg dev in ${projectCwd} (${host}:${port})…`, "info");

    const st = await runtime.startDgDev({
      cwd: projectCwd,
      host,
      port,
      signal: ctx.signal,
      autoConnectGraphql: true,
    });

    setStatusFromRuntime(ctx, runtime);
    if (st.status === "running") {
      await ctx.ui.notify(
        [
          `dg dev running`,
          `graphql: ${st.graphqlUrl}`,
          st.logPath ? `log: ${st.logPath}` : null,
          "Phase 1 inspect tools can use the ephemeral GraphQL URL.",
        ]
          .filter(Boolean)
          .join("\n"),
        "info",
      );
    } else {
      await ctx.ui.notify(
        `dg dev failed: status=${st.status}\n${st.lastError ?? ""}`.trim(),
        "error",
      );
    }
    return;
  }

  await ctx.ui.notify(
    "Usage: /dagster-dev [status|start|stop]\n" +
      "  /dagster-dev start [port=3000] [host=127.0.0.1] [cwd=…] [force=true]",
    "error",
  );
}

/** Parse `key=value` tokens from a command args string. */
export function parseKvArgs(args: string): Record<string, string> {
  const out: Record<string, string> = {};
  const re = /(\w+)=("([^"]*)"|'([^']*)'|(\S+))/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(args)) !== null) {
    const key = m[1]!;
    const value = m[3] ?? m[4] ?? m[5] ?? "";
    out[key] = value;
  }
  return out;
}

async function handleLaunch(
  args: string,
  ctx: ExtensionCommandContext,
  runtime: DagsterRuntime,
): Promise<void> {
  const kv = parseKvArgs(args);
  let jobName: string | undefined = kv.job?.trim() || undefined;
  let assetsRaw: string | undefined = kv.assets?.trim() || undefined;
  const location = kv.location?.trim() || undefined;
  const repo = kv.repo?.trim() || undefined;
  const force = kv.force === "true" || kv.force === "1";

  if (ctx.hasUI && !jobName && !assetsRaw) {
    const mode = await ctx.ui.select("Launch by", ["job", "assets"]);
    if (mode === "job") {
      const entered = await ctx.ui.input("Job name", "");
      jobName = entered?.trim() ? entered.trim() : undefined;
    } else if (mode === "assets") {
      const entered = await ctx.ui.input("Asset keys (comma-separated)", "");
      assetsRaw = entered?.trim() ? entered.trim() : undefined;
    }
  }

  if (!jobName && !assetsRaw) {
    await ctx.ui.notify(
      "Usage: /dagster-launch job=my_job [location=…] [repo=…] [force=true]\n" +
        "       /dagster-launch assets=a,b/c [force=true]",
      "error",
    );
    return;
  }

  const assetSelection = assetsRaw
    ? assetsRaw.split(",").map((s) => s.trim()).filter(Boolean)
    : undefined;

  try {
    const result = await launchRunCore(
      runtime,
      {
        jobName,
        assetSelection,
        repositoryLocationName: location,
        repositoryName: repo,
        force,
      },
      ctx.signal,
      { hasUI: ctx.hasUI, ui: ctx.ui },
    );
    const text = result.content.map((c) => ("text" in c ? c.text : "")).join("\n");
    await ctx.ui.notify(text, "info");
  } catch (err) {
    await ctx.ui.notify(
      err instanceof Error ? err.message : String(err),
      "error",
    );
  }
}

async function handleRun(
  args: string,
  ctx: ExtensionCommandContext,
  runtime: DagsterRuntime,
): Promise<void> {
  const parts = args.trim().split(/\s+/).filter(Boolean);
  const head = parts[0]?.toLowerCase() ?? "";

  if (!head || head === "watches") {
    const watches = runtime.listWatches();
    await ctx.ui.notify(formatWatchStatus(watches), "info");
    return;
  }

  if (head === "watch") {
    const runId = parts[1]?.trim();
    if (!runId) {
      await ctx.ui.notify("Usage: /dagster-run watch <runId>", "error");
      return;
    }
    try {
      const handle = await runtime.startRunLogWatch({
        runId,
        signal: ctx.signal,
      });
      await ctx.ui.notify(
        `Watching run ${runId}\nid: ${handle.id}\nlog: ${handle.logPath}`,
        "info",
      );
    } catch (err) {
      await ctx.ui.notify(err instanceof Error ? err.message : String(err), "error");
    }
    return;
  }

  if (head === "unwatch") {
    const id = parts[1]?.trim();
    if (!id) {
      // stop all
      for (const w of runtime.listWatches()) runtime.stopWatch(w.id);
      await ctx.ui.notify("Stopped all watches", "info");
      return;
    }
    runtime.stopWatch(id);
    await ctx.ui.notify(`Stopped watch ${id}`, "info");
    return;
  }

  // inspect runId
  const runId = parts[0]!.trim();
  try {
    const client = await runtime.ensureClient({ signal: ctx.signal });
    const data = await client.request<{ runOrError: Record<string, unknown> }>({
      query: INSPECT_RUN_QUERY,
      variables: { runId },
      signal: ctx.signal,
      operationName: "DagsterInspectRun",
    });
    const extra = runtime.getActiveProfile()?.redaction?.extraKeyPatterns;
    const result = mapRunOrError(data, extra);
    if (!result.ok) {
      await ctx.ui.notify(
        `Run inspect error (${result.error.typename}): ${result.error.message}`,
        "error",
      );
      return;
    }
    runtime.rememberEntity("run", result.run.runId);
    await ctx.ui.notify(formatRunSummary(result.run), "info");
  } catch (err) {
    await ctx.ui.notify(err instanceof Error ? err.message : String(err), "error");
  }
}
