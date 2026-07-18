/** Reload repository location — fields verified against pinned schema. */

export const RELOAD_LOCATION_MUTATION = /* GraphQL */ `
  mutation DagsterReloadLocation($repositoryLocationName: String!) {
    reloadRepositoryLocation(repositoryLocationName: $repositoryLocationName) {
      __typename
      ... on WorkspaceLocationEntry {
        id
        name
        loadStatus
        updatedTimestamp
      }
      ... on ReloadNotSupported {
        message
      }
      ... on RepositoryLocationNotFound {
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
