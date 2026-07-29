import { defineTool } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import type { DagsterRuntime } from "../../runtime.ts";
import {
  INSPECT_JOB_QUERY,
  LIST_JOB_SELECTORS_QUERY,
} from "../../clients/documents/job.gql.ts";
import {
  findJobSelector,
  formatJobSummary,
  mapPipelineOrError,
} from "../../domain/job.ts";

/**
 * Lazy tool — omit promptSnippet / promptGuidelines.
 */
export function createInspectJobTool(runtime: DagsterRuntime) {
  return defineTool({
    name: "dagster_inspect_job",
    label: "Inspect Job",
    description: "Inspect a Dagster job/pipeline definition (ops, modes, presets)",
    parameters: Type.Object({
      jobName: Type.String({ description: "Job or pipeline name" }),
      repositoryName: Type.Optional(Type.String()),
      locationName: Type.Optional(Type.String()),
    }),
    async execute(_toolCallId, params, signal) {
      if (signal?.aborted) throw new Error("Aborted");
      if (runtime.closed) throw new Error("Dagster runtime is shut down");

      const jobName = params.jobName.trim();
      if (!jobName) throw new Error("jobName is required");

      const client = await runtime.ensureClient({ signal });
      const profile = runtime.getActiveProfile();

      let repositoryName =
        params.repositoryName ?? profile?.defaultRepository ?? undefined;
      let locationName =
        params.locationName ?? profile?.defaultLocation ?? undefined;

      if (!repositoryName || !locationName) {
        const list = await client.request<{
          repositoriesOrError: {
            __typename: string;
            message?: string;
            nodes?: Array<{
              name: string;
              location?: { name?: string };
              jobs?: Array<{ name: string }>;
              pipelines?: Array<{ name: string; isJob?: boolean }>;
            }>;
          };
        }>({
          query: LIST_JOB_SELECTORS_QUERY,
          signal,
          operationName: "DagsterListJobSelectors",
        });

        const node = list.repositoriesOrError;
        if (node.__typename === "RepositoryConnection") {
          const selector = findJobSelector(node.nodes ?? [], jobName, {
            repositoryName,
            locationName,
          });
          if (!selector) {
            return {
              content: [
                {
                  type: "text",
                  text: `Job not found in workspace: ${jobName}`,
                },
              ],
              details: {
                kind: "NotFound",
                typename: "PipelineNotFoundError",
                message: `Job not found: ${jobName}`,
                jobName,
              } as Record<string, unknown>,
            };
          }
          repositoryName = selector.repositoryName;
          locationName = selector.repositoryLocationName;
        } else {
          return {
            content: [
              {
                type: "text",
                text: `Could not list repositories: ${node.message ?? node.__typename}`,
              },
            ],
            details: {
              kind: "Other",
              typename: node.__typename,
              message: node.message ?? node.__typename,
            } as Record<string, unknown>,
          };
        }
      }

      const data = await client.request<{ pipelineOrError: Record<string, unknown> }>({
        query: INSPECT_JOB_QUERY,
        variables: {
          params: {
            pipelineName: jobName,
            repositoryName,
            repositoryLocationName: locationName,
          },
        },
        signal,
        operationName: "DagsterInspectJob",
      });

      const result = mapPipelineOrError(data);
      if (!result.ok) {
        return {
          content: [
            {
              type: "text",
              text: `Job inspect error (${result.error.typename}): ${result.error.message}`,
            },
          ],
          details: {
            kind: result.error.kind,
            typename: result.error.typename,
            message: result.error.message,
            jobName,
            repositoryName,
            locationName,
          } as Record<string, unknown>,
        };
      }

      runtime.rememberEntity("job", result.job.name);

      return {
        content: [{ type: "text", text: formatJobSummary(result.job) }],
        details: {
          kind: "job",
          job: result.job,
          selector: {
            pipelineName: jobName,
            repositoryName,
            repositoryLocationName: locationName,
          },
        } as Record<string, unknown>,
      };
    },
  });
}
