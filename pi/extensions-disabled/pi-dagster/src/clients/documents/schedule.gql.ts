/** Schedule control mutations — fields verified against pinned schema. */

export const START_SCHEDULE_MUTATION = /* GraphQL */ `
  mutation DagsterStartSchedule($scheduleSelector: ScheduleSelector!) {
    startSchedule(scheduleSelector: $scheduleSelector) {
      __typename
      ... on ScheduleStateResult {
        scheduleState {
          id
          name
          status
          repositoryName
          repositoryLocationName
        }
      }
      ... on ScheduleNotFoundError {
        message
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

export const RESET_SCHEDULE_MUTATION = /* GraphQL */ `
  mutation DagsterResetSchedule($scheduleSelector: ScheduleSelector!) {
    resetSchedule(scheduleSelector: $scheduleSelector) {
      __typename
      ... on ScheduleStateResult {
        scheduleState {
          id
          name
          status
          repositoryName
          repositoryLocationName
        }
      }
      ... on ScheduleNotFoundError {
        message
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

/** stopRunningSchedule takes id (preferred) or origin/selector ids — not ScheduleSelector. */
export const STOP_SCHEDULE_MUTATION = /* GraphQL */ `
  mutation DagsterStopSchedule($id: String) {
    stopRunningSchedule(id: $id) {
      __typename
      ... on ScheduleStateResult {
        scheduleState {
          id
          name
          status
          repositoryName
          repositoryLocationName
        }
      }
      ... on ScheduleNotFoundError {
        message
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

/** Resolve schedule instigation state id for stop. */
export const SCHEDULE_LOOKUP_QUERY = /* GraphQL */ `
  query DagsterScheduleLookup($scheduleSelector: ScheduleSelector!) {
    scheduleOrError(scheduleSelector: $scheduleSelector) {
      __typename
      ... on Schedule {
        id
        name
        scheduleState {
          id
          status
        }
      }
      ... on ScheduleNotFoundError {
        message
      }
      ... on UnauthorizedError {
        message
      }
      ... on PythonError {
        message
      }
    }
  }
`;
