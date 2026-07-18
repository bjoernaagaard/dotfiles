/** Job/pipeline inspect query (fields verified against pinned schema). */

export const INSPECT_JOB_QUERY = /* GraphQL */ `
  query DagsterInspectJob($params: PipelineSelector!) {
    pipelineOrError(params: $params) {
      __typename
      ... on Pipeline {
        id
        name
        description
        isJob
        isAssetJob
        graphName
        nodeNames
        modes {
          name
          description
        }
        presets {
          name
          mode
        }
        solids {
          name
        }
        repository {
          name
          location {
            name
          }
        }
        tags {
          key
          value
        }
      }
      ... on PipelineNotFoundError {
        message
      }
      ... on InvalidSubsetError {
        message
      }
      ... on PythonError {
        message
        stack
      }
    }
  }
`;

export const LIST_JOB_SELECTORS_QUERY = /* GraphQL */ `
  query DagsterListJobSelectors {
    repositoriesOrError {
      __typename
      ... on RepositoryConnection {
        nodes {
          name
          location {
            name
          }
          jobs {
            name
          }
          pipelines {
            name
            isJob
          }
        }
      }
      ... on PythonError {
        message
      }
    }
  }
`;
