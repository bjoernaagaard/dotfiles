/** Launch run mutation — fields verified against pinned schema. */

export const LAUNCH_RUN_MUTATION = /* GraphQL */ `
  mutation DagsterLaunchRun($executionParams: ExecutionParams!) {
    launchRun(executionParams: $executionParams) {
      __typename
      ... on LaunchRunSuccess {
        run {
          id
          runId
          status
          pipelineName
          jobName
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
        repositoryName
        repositoryLocationName
      }
      ... on InvalidSubsetError {
        message
      }
      ... on PresetNotFoundError {
        message
        preset
      }
      ... on ConflictingExecutionParamsError {
        message
      }
      ... on NoModeProvidedError {
        message
        pipelineName
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
