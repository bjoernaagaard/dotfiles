/** Terminate run mutation(s) — fields verified against pinned schema. */

export const TERMINATE_RUN_MUTATION = /* GraphQL */ `
  mutation DagsterTerminateRun($runId: String!, $terminatePolicy: TerminateRunPolicy) {
    terminateRun(runId: $runId, terminatePolicy: $terminatePolicy) {
      __typename
      ... on TerminateRunSuccess {
        run {
          id
          runId
          status
        }
      }
      ... on TerminateRunFailure {
        message
        run {
          id
          runId
          status
        }
      }
      ... on RunNotFoundError {
        message
        runId
      }
      ... on UnauthorizedError {
        message
      }
      ... on PythonError {
        message
        stack
      }
    }
  }
`;

export const TERMINATE_RUNS_MUTATION = /* GraphQL */ `
  mutation DagsterTerminateRuns($runIds: [String!]!, $terminatePolicy: TerminateRunPolicy) {
    terminateRuns(runIds: $runIds, terminatePolicy: $terminatePolicy) {
      __typename
      ... on TerminateRunsResult {
        terminateRunResults {
          __typename
          ... on TerminateRunSuccess {
            run {
              id
              runId
              status
            }
          }
          ... on TerminateRunFailure {
            message
            run {
              id
              runId
              status
            }
          }
          ... on RunNotFoundError {
            message
            runId
          }
          ... on UnauthorizedError {
            message
          }
          ... on PythonError {
            message
          }
        }
      }
      ... on PythonError {
        message
        stack
      }
    }
  }
`;
