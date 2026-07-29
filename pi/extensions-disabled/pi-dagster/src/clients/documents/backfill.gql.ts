/** Partition backfill mutations — fields verified against pinned schema. */

export const LAUNCH_BACKFILL_MUTATION = /* GraphQL */ `
  mutation DagsterLaunchBackfill($backfillParams: LaunchBackfillParams!) {
    launchPartitionBackfill(backfillParams: $backfillParams) {
      __typename
      ... on LaunchBackfillSuccess {
        backfillId
        launchedRunIds
      }
      ... on PythonError {
        message
        stack
      }
      ... on UnauthorizedError {
        message
      }
      ... on PartitionSetNotFoundError {
        message
        partitionSetName
      }
      ... on PartitionKeysNotFoundError {
        message
        partitionKeys
      }
      ... on PipelineNotFoundError {
        message
      }
      ... on InvalidSubsetError {
        message
      }
      ... on ConflictingExecutionParamsError {
        message
      }
      ... on RunConfigValidationInvalid {
        pipelineName
        errors {
          message
          path
        }
      }
      ... on RunConflict {
        message
      }
      ... on PresetNotFoundError {
        message
      }
      ... on NoModeProvidedError {
        message
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

export const CANCEL_BACKFILL_MUTATION = /* GraphQL */ `
  mutation DagsterCancelBackfill($backfillId: String!) {
    cancelPartitionBackfill(backfillId: $backfillId) {
      __typename
      ... on CancelBackfillSuccess {
        backfillId
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

export const RESUME_BACKFILL_MUTATION = /* GraphQL */ `
  mutation DagsterResumeBackfill($backfillId: String!) {
    resumePartitionBackfill(backfillId: $backfillId) {
      __typename
      ... on ResumeBackfillSuccess {
        backfillId
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
