/** Run inspect query (fields verified against pinned schema). */

export const INSPECT_RUN_QUERY = /* GraphQL */ `
  query DagsterInspectRun($runId: ID!) {
    runOrError(runId: $runId) {
      __typename
      ... on Run {
        runId
        status
        jobName
        pipelineName
        startTime
        endTime
        creationTime
        mode
        canTerminate
        hasReExecutePermission
        hasTerminatePermission
        hasDeletePermission
        rootRunId
        parentRunId
        tags {
          key
          value
        }
        assetSelection(limit: 50) {
          path
        }
        runConfigYaml
        stepStats {
          stepKey
          status
          startTime
          endTime
        }
      }
      ... on RunNotFoundError {
        message
        runId
      }
      ... on PythonError {
        message
        stack
      }
    }
  }
`;
