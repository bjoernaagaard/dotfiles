import { defineTool } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import type { DagsterRuntime } from "../../runtime.ts";
import { formatDgArgvSummary } from "../../clients/dg.ts";

export function createGetContextTool(runtime: DagsterRuntime) {
  return defineTool({
    name: "dagster_get_context",
    label: "Dagster Get Context",
    description:
      "Get compact Dagster task context before choosing tools: active profile/policy, cwd/project/dg, loaded tools, version, location errors, and cache-only recent entities.",
    promptSnippet: "Get compact Dagster task context",
    parameters: Type.Object({}),
    async execute(_toolCallId, _params, signal, _onUpdate, ctx) {
      if (signal?.aborted) throw new Error("Aborted");
      if (runtime.closed) throw new Error("Dagster runtime is shut down");

      const profile = runtime.getActiveProfilePublic();
      const loaded = runtime.getLoadedLazyTools();
      const caps = runtime.getCachedCapabilities();

      // Soft refresh if we have a target but no cache yet.
      if ((runtime.activeProfileName || runtime.getEphemeralGraphqlUrl()) && !caps) {
        try {
          await runtime.getCapabilities(false, signal);
        } catch {
          // ignore — context still useful offline
        }
      }

      const caps2 = runtime.getCachedCapabilities();
      const conn2 = runtime.getConnectionState();

      let discovery = null as Awaited<ReturnType<typeof runtime.discoverProject>> | null;
      let projectRoot: string | null = profile?.projectRoot ?? null;
      let dgArgv: string[] | null = null;
      try {
        discovery = await runtime.discoverProject(ctx.cwd);
        projectRoot = await runtime.getProjectRoot(ctx.cwd);
      } catch {
        // soft
      }
      try {
        dgArgv = await runtime.resolveDgArgv();
      } catch {
        dgArgv = null;
      }

      const dgDev = runtime.getDgDevState();

      const payload = {
        activeProfile: runtime.activeProfileName,
        policy: runtime.getEffectivePolicy(),
        cwd: ctx.cwd,
        projectRoot,
        projectKind: discovery?.kind ?? null,
        projectMarkers: discovery?.markers ?? [],
        dgArgv: dgArgv ? formatDgArgvSummary(dgArgv) : null,
        dgDev: {
          status: dgDev.status,
          port: dgDev.port ?? null,
          graphqlUrl: dgDev.graphqlUrl ?? null,
          logPath: dgDev.logPath ?? null,
        },
        browserUrl: profile?.browserUrl,
        endpoint:
          runtime.getEphemeralGraphqlUrl() ?? profile?.graphqlHttp ?? null,
        connected: conn2.connected,
        version: caps2?.version ?? conn2.lastVersion ?? null,
        locationErrorCount: caps2?.locationErrorCount ?? 0,
        loadedTools: loaded,
        trusted: ctx.isProjectTrusted(),
        recentEntities: runtime.getRecentEntities(),
        ephemeralReadOnly: runtime.getEphemeralReadOnly(),
      };

      return {
        content: [{ type: "text", text: JSON.stringify(payload, null, 2) }],
        details: {
          activeProfile: runtime.activeProfileName,
          policy: payload.policy,
          cwd: ctx.cwd,
          projectRoot,
          projectKind: payload.projectKind,
          dgArgv: payload.dgArgv,
          dgDev: payload.dgDev,
          loadedTools: loaded,
          version: payload.version,
          locationErrorCount: payload.locationErrorCount,
          recentEntities: payload.recentEntities,
        },
      };
    },
  });
}
