import { defineTool } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import type { DagsterRuntime } from "../../runtime.ts";
import { RELOAD_LOCATION_MUTATION } from "../../clients/documents/location.gql.ts";
import { mapReloadLocationResult } from "../../domain/mutations.ts";
import {
  assertRuntimeOpen,
  auditMutation,
  gateAndConfirm,
  mutationToolResult,
} from "./mutation-helpers.ts";

export function createReloadLocationTool(runtime: DagsterRuntime) {
  return defineTool({
    name: "dagster_reload_location",
    label: "Reload Location",
    description: "Reload a repository location after checking target load status and validating source/config changes with dg check. Remote state is policy-gated; UI confirmation or allowed non-UI force=true is required.",
    parameters: Type.Object({
      repositoryLocationName: Type.Optional(Type.String({ description: "Location to reload; defaults to the active profile location." })),
      force: Type.Optional(Type.Boolean({ description: "Non-UI confirmation override when policy allows; readOnly still blocks." })),
    }),
    async execute(_toolCallId, params, signal, _onUpdate, ctx) {
      assertRuntimeOpen(runtime, signal);
      const name =
        params.repositoryLocationName?.trim() ||
        runtime.getActiveProfile()?.defaultLocation?.trim() ||
        "";
      if (!name) {
        throw new Error(
          "repositoryLocationName is required (or set profile.defaultLocation)",
        );
      }

      const risk = "remote_state" as const;
      try {
        await gateAndConfirm({
          runtime,
          risk,
          force: params.force,
          ctx,
          title: "Confirm reload location",
          message: `Reload repository location "${name}"?`,
        });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        auditMutation({
          runtime,
          tool: "dagster_reload_location",
          risk,
          outcome: msg.includes("declined") ? "declined" : "denied",
          summary: msg,
          entityIds: [name],
        });
        throw err;
      }

      const client = await runtime.ensureClient({ signal: signal ?? ctx?.signal });
      const data = await client.request<{
        reloadRepositoryLocation: Record<string, unknown>;
      }>({
        query: RELOAD_LOCATION_MUTATION,
        variables: { repositoryLocationName: name },
        signal: signal ?? ctx?.signal,
        operationName: "DagsterReloadLocation",
      });

      const outcome = mapReloadLocationResult(data);
      auditMutation({
        runtime,
        tool: "dagster_reload_location",
        risk,
        outcome: outcome.ok ? "success" : "error",
        summary: outcome.summary,
        entityIds: outcome.entityIds,
      });
      return mutationToolResult(outcome);
    },
  });
}
