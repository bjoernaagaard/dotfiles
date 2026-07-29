import { defineTool } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import type { DagsterRuntime } from "../../runtime.ts";
import { capabilitiesCacheAgeMs } from "../../clients/capabilities.ts";
import { formatDgArgvSummary } from "../../clients/dg.ts";

export function createTargetStatusTool(runtime: DagsterRuntime) {
  return defineTool({
    name: "dagster_target_status",
    label: "Dagster Target Status",
    description:
      "Establish the active Dagster target before exploration or mutation: report profile, project trust/root, policy, project/dg, connection, and load status. Never returns secrets.",
    promptSnippet: "Show active Dagster target/profile status",
    parameters: Type.Object({}),
    async execute(_toolCallId, _params, signal, _onUpdate, ctx) {
      if (signal?.aborted) throw new Error("Aborted");
      if (runtime.closed) throw new Error("Dagster runtime is shut down");

      const trusted = ctx.isProjectTrusted();
      const path = runtime.getProfilePath(ctx.cwd);
      const profile = runtime.getActiveProfilePublic();
      const policy = runtime.getEffectivePolicy();
      const cached = runtime.getCachedCapabilities();
      const endpoint =
        runtime.getEphemeralGraphqlUrl() ??
        profile?.graphqlHttp ??
        "(unset)";

      // Best-effort refresh when a profile is active (lazy; errors recorded in connection state).
      if (runtime.activeProfileName || runtime.getEphemeralGraphqlUrl()) {
        try {
          await runtime.getCapabilities(false, signal);
        } catch {
          // connection state already updated
        }
      }

      const conn = runtime.getConnectionState();
      const caps = runtime.getCachedCapabilities() ?? cached;
      const cacheAge = capabilitiesCacheAgeMs(caps);

      let projectRoot: string | null = profile?.projectRoot ?? null;
      let projectKind: string | null = null;
      let dgArgvSummary: string | null = null;
      try {
        const discovery = await runtime.discoverProject(ctx.cwd);
        projectRoot = await runtime.getProjectRoot(ctx.cwd);
        projectKind = discovery?.kind ?? null;
      } catch {
        // soft
      }
      try {
        dgArgvSummary = formatDgArgvSummary(await runtime.resolveDgArgv());
      } catch (err) {
        dgArgvSummary = `(unresolved: ${err instanceof Error ? err.message : String(err)})`;
      }

      const dgDev = runtime.getDgDevState();

      const lines = [
        `activeProfile: ${runtime.activeProfileName ?? "(none)"}`,
        `trusted: ${trusted}`,
        `profilePath: ${path}`,
        `policy: ${policy}`,
        `ephemeralReadOnly: ${runtime.getEphemeralReadOnly()}`,
        `graphqlHttp: ${endpoint}`,
        `projectRoot: ${projectRoot ?? "(unset)"}`,
        `projectKind: ${projectKind ?? "(unknown)"}`,
        `dgArgv: ${dgArgvSummary ?? "(unset)"}`,
        `dgDev: ${dgDev.status}${dgDev.port != null ? ` port=${dgDev.port}` : ""}${dgDev.graphqlUrl ? ` graphql=${dgDev.graphqlUrl}` : ""}`,
        dgDev.logPath ? `dgDevLog: ${dgDev.logPath}` : null,
        dgDev.lastError ? `dgDevError: ${dgDev.lastError.split("\n")[0]}` : null,
        `browserUrl: ${profile?.browserUrl ?? "(unset)"}`,
        `connected: ${conn.connected}`,
        conn.lastVersion ? `version: ${conn.lastVersion}` : null,
        conn.lastErrorKind
          ? `lastError: ${conn.lastErrorKind} — ${conn.lastErrorMessage ?? ""}`
          : null,
        caps
          ? `locations: ${caps.locations.map((l) => `${l.name}=${l.loadStatus}`).join(", ") || "(none)"}${caps.locationErrorCount ? ` (errors: ${caps.locationErrorCount})` : ""}`
          : null,
        cacheAge != null ? `capabilitiesCacheAgeMs: ${cacheAge}` : null,
      ].filter(Boolean) as string[];

      return {
        content: [{ type: "text", text: lines.join("\n") }],
        details: {
          activeProfile: runtime.activeProfileName,
          trusted,
          profilePath: path,
          policy,
          ephemeralReadOnly: runtime.getEphemeralReadOnly(),
          endpoint: typeof endpoint === "string" ? endpoint : "(unset)",
          projectRoot,
          projectKind,
          dgArgv: dgArgvSummary,
          dgDev: {
            status: dgDev.status,
            port: dgDev.port ?? null,
            graphqlUrl: dgDev.graphqlUrl ?? null,
          },
          connected: conn.connected,
          version: conn.lastVersion,
          lastErrorKind: conn.lastErrorKind,
          locationErrorCount: caps?.locationErrorCount ?? null,
          // Never include headersResolver / secrets.
        },
      };
    },
  });
}
