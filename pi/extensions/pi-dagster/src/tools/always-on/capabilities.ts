import { defineTool } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import type { DagsterRuntime } from "../../runtime.ts";
import { capabilitiesCacheAgeMs } from "../../clients/capabilities.ts";

export function createCapabilitiesTool(runtime: DagsterRuntime) {
  return defineTool({
    name: "dagster_capabilities",
    label: "Dagster Capabilities",
    description:
      "Report Dagster version, permissions, location load status, and connection endpoint to establish target capability and trust (no secrets).",
    promptSnippet: "Show Dagster instance capabilities",
    parameters: Type.Object({
      force: Type.Optional(
        Type.Boolean({ description: "Bypass capabilities cache (default false)" }),
      ),
    }),
    async execute(_toolCallId, params, signal) {
      if (signal?.aborted) throw new Error("Aborted");
      if (runtime.closed) throw new Error("Dagster runtime is shut down");

      const snap = await runtime.getCapabilities(Boolean(params.force), signal);
      if (!snap) {
        const conn = runtime.getConnectionState();
        const payload: Record<string, unknown> = {
          connected: false,
          activeProfile: runtime.activeProfileName,
          endpoint: runtime.getEphemeralGraphqlUrl() ?? null,
          errorKind: conn.lastErrorKind ?? "not_connected",
          message:
            conn.lastErrorMessage ??
            "Not connected. Use /dagster-connect or set an active profile with graphqlHttp.",
        };
        return {
          content: [{ type: "text", text: JSON.stringify(payload, null, 2) }],
          details: payload,
        };
      }

      const permissionsSummary = snap.permissions.map((p) => ({
        permission: p.permission,
        value: p.value,
        // omit disabledReason if empty; never secrets
        ...(p.disabledReason ? { disabledReason: p.disabledReason } : {}),
      }));

      const payload: Record<string, unknown> = {
        connected: true,
        activeProfile: runtime.activeProfileName,
        endpoint: snap.endpoint,
        version: snap.version,
        canBulkTerminate: snap.canBulkTerminate,
        permissions: permissionsSummary,
        locations: snap.locations.map((l) => ({
          name: l.name,
          loadStatus: l.loadStatus,
          ...(l.error ? { error: l.error } : {}),
          ...(l.repositories ? { repositories: l.repositories } : {}),
        })),
        locationErrorCount: snap.locationErrorCount,
        workspaceId: snap.workspaceId,
        cacheAgeMs: capabilitiesCacheAgeMs(snap),
      };

      return {
        content: [{ type: "text", text: JSON.stringify(payload, null, 2) }],
        details: {
          connected: true,
          activeProfile: runtime.activeProfileName,
          endpoint: snap.endpoint,
          version: snap.version,
          canBulkTerminate: snap.canBulkTerminate,
          locationErrorCount: snap.locationErrorCount,
          permissionCount: permissionsSummary.length,
        } as Record<string, unknown>,
      };
    },
  });
}
