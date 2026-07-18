/** Reexecute run mutation — fields verified against pinned schema. */

export const REEXECUTE_RUN_MUTATION = /* GraphQL */ `
  mutation DagsterReexecuteRun($reexecutionParams: ReexecutionParams!) {
    launchRunReexecution(reexecutionParams: $reexecutionParams) {
      __typename
      ... on LaunchRunSuccess {
        run {
          id
          runId
          status
          pipelineName
          jobName
          parentRunId
        }
      }
      ... on PythonError {
        message
        stack
      }
      ... on UnauthorizedError {
        message
      }
      ... on PipelineNotFoundError {
        message
        pipelineName
      }
      ... on InvalidSubsetError {
        message
      }
      ... on PresetNotFoundError {
        message
      }
      ... on ConflictingExecutionParamsError {
        message
      }
      ... on NoModeProvidedError {
        message
      }
      ... on RunConflict {
        message
      }
      ... on RunConfigValidationInvalid {
        pipelineName
        errors {
          message
          path
        }
      }
      ... on InvalidStepError {
        invalidStepKey
      }
      ... on InvalidOutputError {
        stepKey
        invalidOutputName
      }
    }
  }
`;
