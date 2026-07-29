/** Capability + workspace health queries (fields verified against pinned schema). */

export const CAPABILITIES_QUERY = /* GraphQL */ `
  query DagsterCapabilities {
    version
    permissions {
      permission
      value
      disabledReason
    }
    canBulkTerminate
    locationStatusesOrError {
      __typename
      ... on WorkspaceLocationStatusEntries {
        entries {
          name
          loadStatus
        }
      }
      ... on PythonError {
        message
        stack
      }
    }
  }
`;

export const WORKSPACE_HEALTH_QUERY = /* GraphQL */ `
  query WorkspaceHealth {
    workspaceOrError {
      __typename
      ... on Workspace {
        id
        locationEntries {
          name
          loadStatus
          locationOrLoadError {
            __typename
            ... on RepositoryLocation {
              name
              repositories {
                name
              }
            }
            ... on PythonError {
              message
            }
          }
        }
      }
      ... on PythonError {
        message
      }
    }
  }
`;
