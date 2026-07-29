/** Bounded catalog slices for multi-entity search. */

export const SEARCH_ASSETS_QUERY = /* GraphQL */ `
  query DagsterSearchAssets {
    assetNodes {
      assetKey {
        path
      }
      groupName
      description
      jobNames
    }
  }
`;

export const SEARCH_REPOS_QUERY = /* GraphQL */ `
  query DagsterSearchRepos {
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
            description
          }
          pipelines {
            name
            description
            isJob
          }
          schedules {
            name
            description
            pipelineName
            cronSchedule
          }
          sensors {
            name
            description
          }
        }
      }
      ... on PythonError {
        message
      }
      ... on RepositoryNotFoundError {
        message
      }
    }
  }
`;

export const SEARCH_RUNS_QUERY = /* GraphQL */ `
  query DagsterSearchRuns($limit: Int) {
    runsOrError(limit: $limit) {
      __typename
      ... on Runs {
        results {
          runId
          status
          jobName
          startTime
          endTime
        }
      }
      ... on PythonError {
        message
      }
      ... on InvalidPipelineRunsFilterError {
        message
      }
    }
  }
`;
