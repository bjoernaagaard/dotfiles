/**
 * Subscription documents — fields verified against pinned schema.
 * Lean message selection: __typename + MessageEvent fields only.
 */

export const RUN_LOGS_SUBSCRIPTION = /* GraphQL */ `
  subscription DagsterRunLogs($runId: ID!, $cursor: String) {
    pipelineRunLogs(runId: $runId, cursor: $cursor) {
      __typename
      ... on PipelineRunLogsSubscriptionSuccess {
        cursor
        hasMorePastEvents
        messages {
          __typename
          ... on MessageEvent {
            runId
            message
            timestamp
            level
            stepKey
            eventType
          }
        }
      }
      ... on PipelineRunLogsSubscriptionFailure {
        message
        missingRunId
      }
    }
  }
`;

export const LOCATION_STATE_SUBSCRIPTION = /* GraphQL */ `
  subscription DagsterLocationState {
    locationStateChangeEvents {
      event {
        eventType
        locationName
        message
      }
    }
  }
`;
