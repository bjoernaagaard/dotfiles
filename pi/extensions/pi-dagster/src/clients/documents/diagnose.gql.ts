import {
  MAX_BASELINE_CANDIDATES,
  MAX_CHECKS_PER_ASSET,
  MAX_EVENTS,
  MAX_MATERIALIZATIONS_PER_ASSET,
} from "../../domain/diagnose.ts";

const PYTHON_ERROR_FIELDS = /* GraphQL */ `
  message
  stack
  errorChain {
    message
    isExplicitLink
    error {
      message
      stack
    }
  }
  causes {
    message
    stack
  }
`;

/** Core bounded run header and event evidence. All selections are in the pinned schema. */
export const DIAGNOSE_RUN_QUERY = /* GraphQL */ `
  query DagsterDiagnoseRun($runId: ID!, $eventLimit: Int!, $afterCursor: String) {
    runOrError(runId: $runId) {
      __typename
      ... on Run {
        runId
        status
        jobName
        pipelineName
        startTime
        endTime
        rootRunId
        parentRunId
        repositoryOrigin {
          repositoryName
          repositoryLocationName
        }
        tags { key value }
        runConfig
        assetSelection(limit: 50) { path }
        assetChecks { name assetKey { path } }
        stepStats { stepKey status startTime endTime }
        eventConnection(limit: $eventLimit, afterCursor: $afterCursor) {
          cursor
          hasMore
          events {
            __typename
            ... on MessageEvent {
              message
              timestamp
              stepKey
              eventType
            }
            ... on ExecutionStepFailureEvent { error { ${PYTHON_ERROR_FIELDS} } }
            ... on ResourceInitFailureEvent { error { ${PYTHON_ERROR_FIELDS} } }
            ... on RunFailureEvent { error { ${PYTHON_ERROR_FIELDS} } }
            ... on HookErroredEvent { error { ${PYTHON_ERROR_FIELDS} } }
            ... on LogsCapturedEvent {
              fileKey
              logKey
              stepKeys
              externalUrl
              externalStdoutUrl
              externalStderrUrl
            }
            ... on AssetCheckEvaluationEvent {
              evaluation {
                checkName
                assetKey { path }
                success
              }
            }
          }
        }
      }
      ... on RunNotFoundError { message runId }
      ... on PythonError { ${PYTHON_ERROR_FIELDS} }
    }
  }
`;

/** Captured logs by Run.fileKey; avoids confusing fileKey with Query.capturedLogs(logKey). */
export const DIAGNOSE_CAPTURED_LOGS_QUERY = /* GraphQL */ `
  query DagsterDiagnoseCapturedLogs($runId: ID!, $fileKey: String!) {
    runOrError(runId: $runId) {
      __typename
      ... on Run {
        runId
        capturedLogs(fileKey: $fileKey) {
          logKey
          stdout
          stderr
          cursor
        }
      }
      ... on RunNotFoundError { message runId }
      ... on PythonError { message stack }
    }
  }
`;

/** Resolve only direct dependency keys for the bounded failed-run asset selection. */
export const DIAGNOSE_DEPENDENCY_KEYS_QUERY = /* GraphQL */ `
  query DagsterDiagnoseDependencyKeys($assetKeys: [AssetKeyInput!]!) {
    assetNodes(assetKeys: $assetKeys) {
      assetKey { path }
      dependencyKeys { path }
    }
  }
`;

/** Fetch bounded upstream materialization and latest-check evidence for selected keys. */
export const DIAGNOSE_UPSTREAM_QUERY = /* GraphQL */ `
  query DagsterDiagnoseUpstream($assetKeys: [AssetKeyInput!]!) {
    assetNodes(assetKeys: $assetKeys) {
      assetKey { path }
      assetMaterializations(limit: ${MAX_MATERIALIZATIONS_PER_ASSET}) {
        runId
        timestamp
        partition
      }
      assetChecksOrError(limit: ${MAX_CHECKS_PER_ASSET}) {
        __typename
        ... on AssetChecks {
          checks {
            name
            executionForLatestMaterialization {
              status
              evaluation {
                description
                success
              }
            }
          }
        }
        ... on AssetCheckNeedsMigrationError { message }
        ... on AssetCheckNeedsUserCodeUpgrade { message }
        ... on AssetCheckNeedsAgentUpgradeError { message }
      }
    }
  }
`;

/** Workspace has no pagination in the pinned schema; callers apply MAX_LOCATIONS client-side. */
export const DIAGNOSE_LOCATIONS_QUERY = /* GraphQL */ `
  query DagsterDiagnoseLocations {
    workspaceOrError {
      __typename
      ... on Workspace {
        locationEntries {
          name
          loadStatus
          locationOrLoadError {
            __typename
            ... on RepositoryLocation { name }
            ... on PythonError { message stack }
          }
        }
      }
      ... on PythonError { message stack }
    }
  }
`;

/** Collision lookup is bounded by the caller's assetKeys input. */
export const DIAGNOSE_COLLISIONS_QUERY = /* GraphQL */ `
  query DagsterDiagnoseCollisions($assetKeys: [AssetKeyInput!]!) {
    assetNodeDefinitionCollisions(assetKeys: $assetKeys) {
      assetKey { path }
      repositories {
        name
        location { name }
      }
    }
  }
`;

/** Server-bounded successful candidates for deterministic client-side comparability. */
export const DIAGNOSE_BASELINE_CANDIDATES_QUERY = /* GraphQL */ `
  query DagsterDiagnoseBaselineCandidates($filter: RunsFilter!, $limit: Int!) {
    runsOrError(filter: $filter, limit: $limit) {
      __typename
      ... on Runs {
        results {
          __typename
          runId
          status
          jobName
          pipelineName
          startTime
          endTime
          rootRunId
          parentRunId
          repositoryOrigin {
            repositoryName
            repositoryLocationName
          }
          tags { key value }
          assetSelection(limit: 50) { path }
        }
      }
      ... on InvalidPipelineRunsFilterError { message }
      ... on PythonError { message stack }
    }
  }
`;

export const DIAGNOSE_DEFAULT_VARIABLES = {
  eventLimit: MAX_EVENTS,
  baselineLimit: MAX_BASELINE_CANDIDATES,
} as const;
