/** Sensor control mutations — fields verified against pinned schema. */

export const START_SENSOR_MUTATION = /* GraphQL */ `
  mutation DagsterStartSensor($sensorSelector: SensorSelector!) {
    startSensor(sensorSelector: $sensorSelector) {
      __typename
      ... on Sensor {
        id
        name
        sensorState {
          id
          status
        }
      }
      ... on SensorNotFoundError {
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

export const RESET_SENSOR_MUTATION = /* GraphQL */ `
  mutation DagsterResetSensor($sensorSelector: SensorSelector!) {
    resetSensor(sensorSelector: $sensorSelector) {
      __typename
      ... on Sensor {
        id
        name
        sensorState {
          id
          status
        }
      }
      ... on SensorNotFoundError {
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

/** stopSensor takes id (preferred) — not SensorSelector. */
export const STOP_SENSOR_MUTATION = /* GraphQL */ `
  mutation DagsterStopSensor($id: String) {
    stopSensor(id: $id) {
      __typename
      ... on StopSensorMutationResult {
        instigationState {
          id
          name
          status
          repositoryName
          repositoryLocationName
        }
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

export const SENSOR_LOOKUP_QUERY = /* GraphQL */ `
  query DagsterSensorLookup($sensorSelector: SensorSelector!) {
    sensorOrError(sensorSelector: $sensorSelector) {
      __typename
      ... on Sensor {
        id
        name
        sensorState {
          id
          status
        }
      }
      ... on SensorNotFoundError {
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
