import { appendFile, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import {
  extractActiveProfileFromBranch,
  extractPreviouslyLoadedFromBranch,
  type BranchEntry,
} from "./state/session.ts";
import {
  getProfilePath,
  listProfiles,
  publicProfileView,
  type Profile,
  type ProfilesFile,
} from "./state/profiles.ts";
import {
  createGraphqlClient,
  resolveGraphqlEndpoint,
  type GraphqlClient,
} from "./clients/graphql.ts";
import {
  clearCapabilitiesCache,
  createCapabilitiesCache,
  fetchCapabilities,
  type CapabilitiesCache,
  type CapabilitiesSnapshot,
} from "./clients/capabilities.ts";
import {
  formatDgArgvSummary,
  resolveDgArgv,
  runDg,
  type DgRunOptions,
  type DgRunResult,
  type DgSpawnRunner,
} from "./clients/dg.ts";
import {
  createDgDevController,
  type DgDevController,
  type DgDevState,
  type StartDgDevOptions,
} from "./clients/dg-dev.ts";
import {
  createWsClient,
  resolveGraphqlWsUrl,
  type WsClient,
} from "./clients/ws.ts";
import { RUN_LOGS_SUBSCRIPTION } from "./clients/documents/subscribe.gql.ts";
import { discoverProject, resolveProjectRoot, type ProjectDiscovery } from "./domain/project.ts";
import { DagsterError, type DagsterClientErrorKind } from "./domain/errors.ts";
import {
  formatWatchStatus,
  isUrgentLogEvent,
  makeWatchId,
  summarizeLogMessage,
  type RunLogEventSummary,
  type WatchHandle,
} from "./domain/watches.ts";
import type { ProfilePolicy } from "./policy/types.ts";
import { defaultPolicy } from "./policy/risk.ts";
import type { AuditEntry } from "./policy/audit.ts";
import {
  clearOpenIncident,
  cloneIncidentState,
  emptyIncidentState,
  mergeIncidentState,
  recordAuditInIncident,
  reconstructIncidentState,
  type IncidentPatch,
  type IncidentState,
} from "./state/incident.ts";
import {
  createEntityCache,
  type EntityReference,
} from "./state/entities.ts";

export type { EntityReference };

export type ConnectionState = {
  connected: boolean;
  lastErrorKind?: DagsterClientErrorKind;
  lastErrorMessage?: string;
  lastVersion?: string;
};

export type { DgDevState, ProjectDiscovery, WatchHandle };

export type WatchFlushMode = "settled" | "urgent";

export type PendingWatchNotification = {
  watchId: string;
  urgent: boolean;
  summary: string;
  logPath?: string;
  notifyModel: boolean;
  delivered: boolean;
};

type InternalWatch = {
  handle: WatchHandle;
  stop: () => void;
  recent: RunLogEventSummary[];
  pending?: PendingWatchNotification;
  abort?: AbortController;
};

export type StartRunLogWatchOpts = {
  runId: string;
  signal?: AbortSignal;
  notifyModel?: boolean;
};

export type DagsterRuntime = {
  pi: ExtensionAPI;
  profiles: Profile[];
  activeProfileName: string | null;
  loadedLazyTools: Set<string>;
  watches: Map<string, InternalWatch>;
  closed: boolean;

  getProfilePath(cwd: string): string;
  listProfiles(cwd: string, trusted: boolean): Promise<Profile[]>;
  getActiveProfile(): Profile | null;
  getActiveProfilePublic(): Omit<Profile, "headersResolver" | "headers"> | null;
  setActiveProfile(name: string | null): void;
  /** Upsert a session-only (or persisted) profile into in-memory list. */
  upsertProfile(profile: Profile): void;
  markToolsLoaded(names: string[]): void;
  getLoadedLazyTools(): string[];
  clearLoadedLazyTools(): void;
  reconstructFromBranch(sessionManager: { getBranch(): BranchEntry[] }): void;

  getClient(): GraphqlClient | null;
  ensureClient(opts?: { signal?: AbortSignal }): Promise<GraphqlClient>;
  invalidateClient(): void;
  getCapabilities(force?: boolean, signal?: AbortSignal): Promise<CapabilitiesSnapshot | null>;
  getCachedCapabilities(): CapabilitiesSnapshot | null;
  setEphemeralGraphqlUrl(url: string | null): void;
  setEphemeralReadOnly(flag: boolean): void;
  getEphemeralGraphqlUrl(): string | null;
  getEphemeralReadOnly(): boolean;
  /** Effective policy after ephemeral read-only override. */
  getEffectivePolicy(): ProfilePolicy;
  getConnectionState(): ConnectionState;
  /** Remember entity for autocomplete/context (bounded cache; no secrets). */
  rememberEntity(
    kind: string,
    id: string,
    metadata?: { label?: string; description?: string },
  ): void;
  /** Last few entity ids for get_context (compatibility bound). */
  getRecentEntities(): Array<{ kind: string; id: string }>;
  /** Full bounded entity-reference cache for autocomplete/completions. */
  getEntityReferences(options?: {
    kinds?: string[];
    limit?: number;
  }): EntityReference[];

  // --- Phase 4: branch-scoped diagnosis state ---
  recordIncident(patch: IncidentPatch): IncidentState;
  recordAudit(entry: AuditEntry): IncidentState;
  getIncidentSnapshot(): IncidentState;
  reconstructIncident(entries: readonly BranchEntry[]): IncidentState;
  clearIncident(): IncidentState;

  updateStatusLine(): void;

  // --- Phase 2: local author / dg ---
  /** Profile.projectRoot if valid, else discovered root, else cwd. */
  getProjectRoot(cwd: string): Promise<string>;
  discoverProject(cwd: string): Promise<ProjectDiscovery | null>;
  /** Resolved dg argv (binary only, no env secrets). */
  resolveDgArgv(profile?: Profile | null): Promise<string[]>;
  runDg(opts: DgRunOptions & { profile?: Profile | null }): Promise<DgRunResult>;
  getDgDevState(): DgDevState;
  startDgDev(opts: StartDgDevOptions): Promise<DgDevState>;
  stopDgDev(opts?: { force?: boolean; signal?: AbortSignal }): Promise<DgDevState>;
  waitDgDevReady(opts?: {
    signal?: AbortSignal;
    timeoutMs?: number;
  }): Promise<{ graphqlUrl: string }>;
  /** First TUI confirm for dg dev start this session. */
  markDevStartConfirmed(): void;
  wasDevStartConfirmed(): boolean;
  /** Inject spawn runner for tests (one-shot dg). */
  setDgRunnerForTests(runner: DgSpawnRunner | null): void;
  /** Inject path lookup for tests. */
  setDgPathLookupForTests(lookup: ((bin: string) => Promise<boolean>) | null): void;

  // --- Phase 3: WS + watches ---
  ensureWsClient(opts?: { signal?: AbortSignal }): Promise<WsClient>;
  getWsClient(): WsClient | null;
  invalidateWsClient(): void;
  /** Inject WS client factory for tests. */
  setWsClientFactoryForTests(
    factory: ((url: string, profile: Profile | null) => WsClient) | null,
  ): void;
  startRunLogWatch(opts: StartRunLogWatchOpts): Promise<WatchHandle>;
  stopWatch(id: string): void;
  listWatches(): WatchHandle[];
  getWatch(id: string): WatchHandle | undefined;
  flushWatchNotifications(mode: WatchFlushMode): PendingWatchNotification[];
  /** Drain pending notifications that should be shown (for agent_settled). */
  takePendingWatchNotifications(mode: WatchFlushMode): PendingWatchNotification[];

  /** Attach the current session UI so background state changes reach Pi's status map. */
  setStatusSink(sink: ((key: string, text: string | undefined) => void) | undefined): void;

  shutdown(): void;
};

/**
 * Create a fresh per-extension-instance runtime.
 * Do not use process-global singletons — Pi reloads create new extension runtimes.
 */
export function createRuntime(pi: ExtensionAPI): DagsterRuntime {
  const state = {
    profiles: [] as Profile[],
    activeProfileName: null as string | null,
    loadedLazyTools: new Set<string>(),
    watches: new Map<string, InternalWatch>(),
    closed: false,
    client: null as GraphqlClient | null,
    clientEndpoint: null as string | null,
    wsClient: null as WsClient | null,
    wsUrl: null as string | null,
    capabilitiesCache: createCapabilitiesCache() as CapabilitiesCache,
    ephemeralGraphqlUrl: null as string | null,
    ephemeralReadOnly: false,
    connection: { connected: false } as ConnectionState,
    entityCache: createEntityCache(),
    incident: emptyIncidentState() as IncidentState,
    devStartConfirmed: false,
    dgRunner: null as DgSpawnRunner | null,
    dgPathLookup: null as ((bin: string) => Promise<boolean>) | null,
    wsClientFactory: null as ((url: string, profile: Profile | null) => WsClient) | null,
    statusSink: undefined as ((key: string, text: string | undefined) => void) | undefined,
  };

  function clearClientState(): void {
    state.client = null;
    state.clientEndpoint = null;
    clearCapabilitiesCache(state.capabilitiesCache);
    state.connection = { connected: false };
    // HTTP invalidate also drops WS (endpoint may have changed).
    runtime.invalidateWsClient();
  }

  function stopAllWatches(): void {
    for (const [id, w] of [...state.watches.entries()]) {
      try {
        w.stop();
      } catch {
        // ignore
      }
      w.handle.status = "stopped";
      state.watches.delete(id);
    }
  }

  const dgDev: DgDevController = createDgDevController({
    onStateChange: () => {
      runtime.updateStatusLine();
    },
    onSetEphemeralGraphql: (url) => {
      // Only clear/set ephemeral URL when controller requests it.
      runtime.setEphemeralGraphqlUrl(url);
    },
  });

  const runtime: DagsterRuntime = {
    get pi() {
      return pi;
    },
    get profiles() {
      return state.profiles;
    },
    get activeProfileName() {
      return state.activeProfileName;
    },
    get loadedLazyTools() {
      return state.loadedLazyTools;
    },
    get watches() {
      return state.watches;
    },
    get closed() {
      return state.closed;
    },

    getProfilePath(cwd: string): string {
      return getProfilePath(cwd);
    },

    async listProfiles(cwd: string, trusted: boolean): Promise<Profile[]> {
      // Fail-closed: untrusted projects skip project-local profile file reads.
      // Session-only (ephemeral) profiles already in memory are preserved.
      const file: ProfilesFile = await listProfiles(cwd, trusted);
      const sessionOnly = state.profiles.filter(
        (p) => !file.profiles.some((fp) => fp.name === p.name),
      );
      state.profiles = [...file.profiles, ...sessionOnly];
      if (file.active && state.profiles.some((p) => p.name === file.active)) {
        state.activeProfileName = file.active;
      } else if (
        state.activeProfileName &&
        !state.profiles.some((p) => p.name === state.activeProfileName)
      ) {
        state.activeProfileName = null;
      }
      return state.profiles;
    },

    getActiveProfile(): Profile | null {
      if (!state.activeProfileName) return null;
      return state.profiles.find((p) => p.name === state.activeProfileName) ?? null;
    },

    getActiveProfilePublic(): Omit<Profile, "headersResolver" | "headers"> | null {
      const profile = runtime.getActiveProfile();
      return profile ? publicProfileView(profile) : null;
    },

    setActiveProfile(name: string | null): void {
      if (name === null) {
        state.activeProfileName = null;
        runtime.invalidateClient();
        runtime.updateStatusLine();
        return;
      }
      if (!state.profiles.some((p) => p.name === name)) {
        throw new Error(`Unknown Dagster profile: ${name}`);
      }
      if (state.activeProfileName !== name) {
        state.activeProfileName = name;
        runtime.invalidateClient();
      }
      runtime.updateStatusLine();
    },

    upsertProfile(profile: Profile): void {
      const idx = state.profiles.findIndex((p) => p.name === profile.name);
      if (idx >= 0) state.profiles[idx] = profile;
      else state.profiles.push(profile);
    },

    markToolsLoaded(names: string[]): void {
      for (const n of names) state.loadedLazyTools.add(n);
    },

    getLoadedLazyTools(): string[] {
      return [...state.loadedLazyTools];
    },

    clearLoadedLazyTools(): void {
      state.loadedLazyTools.clear();
    },

    reconstructFromBranch(sessionManager: { getBranch(): BranchEntry[] }): void {
      const branch = sessionManager.getBranch();
      const previouslyLoaded = extractPreviouslyLoadedFromBranch(branch);
      state.loadedLazyTools = new Set(previouslyLoaded);

      const extra = runtime.getActiveProfile()?.redaction?.extraKeyPatterns ?? [];
      state.incident = reconstructIncidentState(branch, extra);

      const activeFromBranch = extractActiveProfileFromBranch(branch) ?? state.incident.profileName ?? null;
      if (activeFromBranch && state.profiles.some((p) => p.name === activeFromBranch)) {
        state.activeProfileName = activeFromBranch;
      }
    },

    getClient(): GraphqlClient | null {
      return state.client;
    },

    async ensureClient(opts?: { signal?: AbortSignal }): Promise<GraphqlClient> {
      if (state.closed) {
        throw new DagsterError({ kind: "config", message: "Dagster runtime is shut down" });
      }
      if (opts?.signal?.aborted) {
        throw new DagsterError({ kind: "aborted", message: "Request aborted" });
      }

      const profile = runtime.getActiveProfile();
      let endpoint: string;
      try {
        endpoint = resolveGraphqlEndpoint({
          graphqlHttp: profile?.graphqlHttp,
          pathPrefix: profile?.pathPrefix,
          ephemeralUrl: state.ephemeralGraphqlUrl,
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        state.connection = {
          connected: false,
          lastErrorKind: "config",
          lastErrorMessage: message,
        };
        throw err;
      }

      if (state.client && state.clientEndpoint === endpoint) {
        return state.client;
      }

      // Recreate client for new endpoint; drop capability cache for old endpoint implicitly.
      // Also drop WS (may point at previous endpoint).
      runtime.invalidateWsClient();
      state.client = createGraphqlClient({
        endpoint,
        staticHeaders: profile?.headers,
        headersResolver: profile?.headersResolver,
      });
      state.clientEndpoint = endpoint;
      state.connection = {
        connected: true,
        lastVersion: state.connection.lastVersion,
      };
      return state.client;
    },

    invalidateClient(): void {
      clearClientState();
    },

    async getCapabilities(
      force = false,
      signal?: AbortSignal,
    ): Promise<CapabilitiesSnapshot | null> {
      try {
        const client = await runtime.ensureClient({ signal });
        const snap = await fetchCapabilities(client, {
          force,
          cache: state.capabilitiesCache,
          signal,
        });
        state.connection = {
          connected: true,
          lastVersion: snap.version,
        };
        return snap;
      } catch (err) {
        const kind =
          err instanceof DagsterError ? err.kind : ("transport" as DagsterClientErrorKind);
        const message = err instanceof Error ? err.message : String(err);
        state.connection = {
          connected: false,
          lastErrorKind: kind,
          lastErrorMessage: message,
          lastVersion: state.connection.lastVersion,
        };
        // When not configured, return null rather than throw for status tools.
        if (kind === "config" || kind === "not_connected") return null;
        throw err;
      }
    },

    getCachedCapabilities(): CapabilitiesSnapshot | null {
      const endpoint = state.clientEndpoint;
      if (!endpoint) return null;
      return state.capabilitiesCache.byEndpoint.get(endpoint) ?? null;
    },

    setEphemeralGraphqlUrl(url: string | null): void {
      state.ephemeralGraphqlUrl = url;
      runtime.invalidateClient();
      runtime.updateStatusLine();
    },

    setEphemeralReadOnly(flag: boolean): void {
      state.ephemeralReadOnly = flag;
      runtime.updateStatusLine();
    },

    getEphemeralGraphqlUrl(): string | null {
      return state.ephemeralGraphqlUrl;
    },

    getEphemeralReadOnly(): boolean {
      return state.ephemeralReadOnly;
    },

    getEffectivePolicy(): ProfilePolicy {
      if (state.ephemeralReadOnly) return "readOnly";
      return runtime.getActiveProfile()?.policy ?? defaultPolicy();
    },

    getConnectionState(): ConnectionState {
      return { ...state.connection };
    },

    rememberEntity(
      kind: string,
      id: string,
      metadata?: { label?: string; description?: string },
    ): void {
      state.entityCache.rememberEntity(kind, id, metadata);
    },

    getRecentEntities(): Array<{ kind: string; id: string }> {
      return state.entityCache.getRecentEntities();
    },

    getEntityReferences(options?: {
      kinds?: string[];
      limit?: number;
    }): EntityReference[] {
      return state.entityCache.getEntityReferences(options);
    },

    recordIncident(patch: IncidentPatch): IncidentState {
      const extra = runtime.getActiveProfile()?.redaction?.extraKeyPatterns ?? [];
      state.incident = mergeIncidentState(state.incident, patch, extra);
      return cloneIncidentState(state.incident);
    },

    recordAudit(entry: AuditEntry): IncidentState {
      const extra = runtime.getActiveProfile()?.redaction?.extraKeyPatterns ?? [];
      state.incident = recordAuditInIncident(state.incident, entry, extra);
      for (const id of entry.entityIds ?? []) runtime.rememberEntity("run", id);
      return cloneIncidentState(state.incident);
    },

    getIncidentSnapshot(): IncidentState {
      return cloneIncidentState(state.incident);
    },

    reconstructIncident(entries: readonly BranchEntry[]): IncidentState {
      const extra = runtime.getActiveProfile()?.redaction?.extraKeyPatterns ?? [];
      state.incident = reconstructIncidentState(entries, extra);
      return cloneIncidentState(state.incident);
    },

    clearIncident(): IncidentState {
      state.incident = clearOpenIncident(state.incident);
      return cloneIncidentState(state.incident);
    },

    async getProjectRoot(cwd: string): Promise<string> {
      const profile = runtime.getActiveProfile();
      const { root } = await resolveProjectRoot({
        cwd,
        profileProjectRoot: profile?.projectRoot,
      });
      return root;
    },

    async discoverProject(cwd: string): Promise<ProjectDiscovery | null> {
      const profile = runtime.getActiveProfile();
      if (profile?.projectRoot) {
        return discoverProject(profile.projectRoot);
      }
      return discoverProject(cwd);
    },

    async resolveDgArgv(profile?: Profile | null): Promise<string[]> {
      const p = profile === undefined ? runtime.getActiveProfile() : profile;
      return resolveDgArgv({
        dgCommand: p?.dgCommand,
        pathLookup: state.dgPathLookup ?? undefined,
      });
    },

    async runDg(opts: DgRunOptions & { profile?: Profile | null }): Promise<DgRunResult> {
      if (state.closed) {
        throw new Error("Dagster runtime is shut down");
      }
      if (opts.signal?.aborted) {
        throw new Error("dg command aborted");
      }
      const profile =
        opts.profile === undefined ? runtime.getActiveProfile() : opts.profile;
      const dgArgv = await runtime.resolveDgArgv(profile);
      return runDg({
        args: opts.args,
        cwd: opts.cwd,
        env: opts.env,
        signal: opts.signal,
        timeoutMs: opts.timeoutMs,
        jsonHint: opts.jsonHint,
        dgArgv,
        runner: state.dgRunner ?? undefined,
        extraKeyPatterns: profile?.redaction?.extraKeyPatterns,
        rejectDev: true,
      });
    },

    getDgDevState(): DgDevState {
      return dgDev.getState();
    },

    async startDgDev(opts: StartDgDevOptions): Promise<DgDevState> {
      if (state.closed) {
        throw new Error("Dagster runtime is shut down");
      }
      const profile = runtime.getActiveProfile();
      return dgDev.start({
        ...opts,
        dgCommand: opts.dgCommand ?? profile?.dgCommand,
        pathLookup: opts.pathLookup ?? state.dgPathLookup ?? undefined,
      });
    },

    async stopDgDev(opts?: { force?: boolean; signal?: AbortSignal }): Promise<DgDevState> {
      return dgDev.stop(opts);
    },

    async waitDgDevReady(opts?: {
      signal?: AbortSignal;
      timeoutMs?: number;
    }): Promise<{ graphqlUrl: string }> {
      return dgDev.waitReady(opts);
    },

    markDevStartConfirmed(): void {
      state.devStartConfirmed = true;
    },

    wasDevStartConfirmed(): boolean {
      return state.devStartConfirmed;
    },

    setDgRunnerForTests(runner: DgSpawnRunner | null): void {
      state.dgRunner = runner;
    },

    setDgPathLookupForTests(lookup: ((bin: string) => Promise<boolean>) | null): void {
      state.dgPathLookup = lookup;
    },

    async ensureWsClient(opts?: { signal?: AbortSignal }): Promise<WsClient> {
      if (state.closed) {
        throw new DagsterError({ kind: "config", message: "Dagster runtime is shut down" });
      }
      if (opts?.signal?.aborted) {
        throw new DagsterError({ kind: "aborted", message: "Request aborted" });
      }

      const profile = runtime.getActiveProfile();
      let url: string;
      try {
        url = resolveGraphqlWsUrl({
          graphqlWs: profile?.graphqlWs,
          graphqlHttp: profile?.graphqlHttp,
          pathPrefix: profile?.pathPrefix,
          ephemeralUrl: state.ephemeralGraphqlUrl,
        });
      } catch (err) {
        throw err;
      }

      if (state.wsClient && state.wsUrl === url) {
        return state.wsClient;
      }

      // Close previous
      runtime.invalidateWsClient();

      if (state.wsClientFactory) {
        state.wsClient = state.wsClientFactory(url, profile);
      } else {
        state.wsClient = createWsClient({
          url,
          staticHeaders: profile?.headers,
          headersResolver: profile?.headersResolver,
        });
      }
      state.wsUrl = url;
      return state.wsClient;
    },

    getWsClient(): WsClient | null {
      return state.wsClient;
    },

    invalidateWsClient(): void {
      // Stop watches that depend on WS before disposing client.
      stopAllWatches();
      try {
        state.wsClient?.close();
      } catch {
        // ignore
      }
      state.wsClient = null;
      state.wsUrl = null;
    },

    setWsClientFactoryForTests(factory): void {
      state.wsClientFactory = factory;
    },

    async startRunLogWatch(opts: StartRunLogWatchOpts): Promise<WatchHandle> {
      if (state.closed) {
        throw new DagsterError({ kind: "config", message: "Dagster runtime is shut down" });
      }
      const runId = opts.runId.trim();
      if (!runId) throw new Error("runId is required");

      const ws = await runtime.ensureWsClient({ signal: opts.signal });
      const id = makeWatchId("run_logs", runId);
      const dir = await mkdtemp(join(tmpdir(), "pi-dagster-watch-"));
      const logPath = join(dir, `${runId}.jsonl`);
      await writeFile(logPath, "", "utf8");

      const handle: WatchHandle = {
        id,
        kind: "run_logs",
        runId,
        startedAt: Date.now(),
        status: "active",
        logPath,
        eventCount: 0,
        urgentFailure: false,
        notifyModel: Boolean(opts.notifyModel),
      };

      const abort = new AbortController();
      if (opts.signal) {
        if (opts.signal.aborted) abort.abort();
        else {
          opts.signal.addEventListener("abort", () => abort.abort(), { once: true });
        }
      }

      const recent: RunLogEventSummary[] = [];
      let stopSub: (() => void) | null = null;

      const internal: InternalWatch = {
        handle,
        recent,
        abort,
        stop: () => {
          try {
            stopSub?.();
          } catch {
            // ignore
          }
          try {
            abort.abort();
          } catch {
            // ignore
          }
          handle.status = handle.status === "error" ? "error" : "stopped";
        },
      };

      state.watches.set(id, internal);

      type RunLogsPayload = {
        pipelineRunLogs?: {
          __typename?: string;
          cursor?: string;
          hasMorePastEvents?: boolean;
          messages?: Array<Record<string, unknown>>;
          message?: string;
          missingRunId?: string;
        };
      };

      try {
        const sub = await ws.subscribe<RunLogsPayload>({
          query: RUN_LOGS_SUBSCRIPTION,
          variables: { runId },
          signal: abort.signal,
          onNext: (data) => {
            const payload = data.pipelineRunLogs;
            if (!payload) return;
            const typename = String(payload.__typename ?? "");
            handle.lastEventAt = Date.now();

            if (typename === "PipelineRunLogsSubscriptionFailure") {
              handle.urgentFailure = true;
              handle.lastError = payload.message ?? "pipelineRunLogs failure";
              handle.status = "error";
              internal.pending = {
                watchId: id,
                urgent: true,
                summary: `Watch ${id} failure for run ${runId}: ${handle.lastError}`,
                logPath,
                notifyModel: Boolean(opts.notifyModel),
                delivered: false,
              };
              return;
            }

            const messages = payload.messages ?? [];
            for (const msg of messages) {
              const summary = summarizeLogMessage(msg);
              recent.push(summary);
              if (recent.length > 20) recent.shift();
              handle.eventCount = (handle.eventCount ?? 0) + 1;
              void appendFile(logPath, `${JSON.stringify(summary)}\n`, "utf8").catch(() => {
                // best-effort log write
              });
              if (isUrgentLogEvent(summary)) {
                handle.urgentFailure = true;
                internal.pending = {
                  watchId: id,
                  urgent: true,
                  summary: `Run ${runId} ${summary.typename}${
                    summary.stepKey ? ` step=${summary.stepKey}` : ""
                  }: ${summary.message ?? ""}`.trim(),
                  logPath,
                  notifyModel: Boolean(opts.notifyModel),
                  delivered: false,
                };
              }
            }
          },
          onError: (err) => {
            handle.status = "error";
            handle.lastError = err.message;
            handle.urgentFailure = true;
            internal.pending = {
              watchId: id,
              urgent: true,
              summary: `Watch ${id} error for run ${runId}: ${err.message}`,
              logPath,
              notifyModel: Boolean(opts.notifyModel),
              delivered: false,
            };
          },
          onComplete: () => {
            if (handle.status === "active") handle.status = "stopped";
          },
        });
        stopSub = sub.stop;
      } catch (err) {
        state.watches.delete(id);
        throw err;
      }

      runtime.rememberEntity("run", runId);
      return { ...handle };
    },

    stopWatch(id: string): void {
      const w = state.watches.get(id);
      if (!w) {
        // Also allow stop by runId
        for (const [wid, ww] of state.watches.entries()) {
          if (ww.handle.runId === id) {
            ww.stop();
            state.watches.delete(wid);
            return;
          }
        }
        return;
      }
      w.stop();
      state.watches.delete(id);
    },

    listWatches(): WatchHandle[] {
      return [...state.watches.values()].map((w) => ({ ...w.handle }));
    },

    getWatch(id: string): WatchHandle | undefined {
      const w = state.watches.get(id);
      return w ? { ...w.handle } : undefined;
    },

    flushWatchNotifications(mode: WatchFlushMode): PendingWatchNotification[] {
      return runtime.takePendingWatchNotifications(mode);
    },

    takePendingWatchNotifications(mode: WatchFlushMode): PendingWatchNotification[] {
      const out: PendingWatchNotification[] = [];
      for (const w of state.watches.values()) {
        if (!w.pending || w.pending.delivered) continue;
        if (mode === "urgent" && !w.pending.urgent) continue;
        w.pending.delivered = true;
        out.push({ ...w.pending });
      }
      return out;
    },

    updateStatusLine(): void {
      try {
        const setStatus =
          state.statusSink ??
          (pi as ExtensionAPI & { setStatus?: (k: string, t: string | undefined) => void })
            .setStatus;
        if (typeof setStatus !== "function") return;
        if (state.closed) {
          setStatus("dagster", undefined);
          return;
        }
        const name = state.activeProfileName ?? "none";
        const errs = state.connection.lastErrorKind ? " ⚠" : "";
        const dev = dgDev.getState();
        let devSuffix = "";
        if (dev.status === "running" && dev.port != null) {
          devSuffix = ` dev:${dev.port}`;
        } else if (dev.status === "starting") {
          devSuffix = " ★dev";
        } else if (dev.status === "error") {
          devSuffix = " dev⚠";
        }
        const watchCount = state.watches.size;
        const watchSuffix = watchCount > 0 ? ` w:${watchCount}` : "";
        setStatus("dagster", `dagster:${name}${devSuffix}${watchSuffix}${errs}`);
      } catch {
        // Status line is best-effort.
      }
    },

    setStatusSink(sink): void {
      state.statusSink = sink;
      runtime.updateStatusLine();
    },

    shutdown(): void {
      // Idempotent: safe to call twice.
      if (state.closed) return;
      state.closed = true;
      stopAllWatches();
      try {
        state.wsClient?.close();
      } catch {
        // ignore
      }
      state.wsClient = null;
      state.wsUrl = null;
      // Kill long-lived dg dev before dropping client state.
      try {
        dgDev.dispose();
      } catch {
        // ignore
      }
      state.client = null;
      state.clientEndpoint = null;
      clearCapabilitiesCache(state.capabilitiesCache);
      state.connection = { connected: false };
      try {
        const setStatus =
          state.statusSink ??
          (pi as ExtensionAPI & { setStatus?: (k: string, t: string | undefined) => void })
            .setStatus;
        setStatus?.("dagster", undefined);
      } catch {
        // ignore
      } finally {
        state.statusSink = undefined;
      }
    },
  };

  // Silence unused helper in case tree-shaking in tests
  void formatDgArgvSummary;
  void formatWatchStatus;

  return runtime;
}
