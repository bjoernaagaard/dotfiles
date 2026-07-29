import { defineTool } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import type { DagsterRuntime } from "../../runtime.ts";
import { INSPECT_ASSET_QUERY } from "../../clients/documents/asset.gql.ts";
import {
  formatAssetSummary,
  mapAssetNodeOrError,
  parseAssetKeyInput,
} from "../../domain/asset.ts";

/**
 * Lazy tool — omit promptSnippet / promptGuidelines.
 */
export function createInspectAssetTool(runtime: DagsterRuntime) {
  return defineTool({
    name: "dagster_inspect_asset",
    label: "Inspect Asset",
    description: "Inspect a Dagster asset definition and recent materializations",
    parameters: Type.Object({
      assetKey: Type.String({
        description: 'Asset key as "path/with/slashes" or JSON array string',
      }),
    }),
    async execute(_toolCallId, params, signal) {
      if (signal?.aborted) throw new Error("Aborted");
      if (runtime.closed) throw new Error("Dagster runtime is shut down");

      const path = parseAssetKeyInput(params.assetKey);
      if (path.length === 0) {
        throw new Error('assetKey is required (e.g. "my/asset" or \'["my","asset"]\')');
      }

      const client = await runtime.ensureClient({ signal });
      const data = await client.request<{ assetNodeOrError: Record<string, unknown> }>({
        query: INSPECT_ASSET_QUERY,
        variables: { assetKey: { path } },
        signal,
        operationName: "DagsterInspectAsset",
      });

      const result = mapAssetNodeOrError(data);
      if (!result.ok) {
        return {
          content: [
            {
              type: "text",
              text: `Asset inspect error (${result.error.typename}): ${result.error.message}`,
            },
          ],
          details: {
            kind: result.error.kind,
            typename: result.error.typename,
            message: result.error.message,
            assetKey: path.join("/"),
          } as Record<string, unknown>,
        };
      }

      runtime.rememberEntity("asset", result.asset.assetKey);

      return {
        content: [{ type: "text", text: formatAssetSummary(result.asset) }],
        details: {
          kind: "asset",
          asset: result.asset,
        } as Record<string, unknown>,
      };
    },
  });
}
