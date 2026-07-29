/** Asset inspect query (fields verified against pinned schema). */

export const INSPECT_ASSET_QUERY = /* GraphQL */ `
  query DagsterInspectAsset($assetKey: AssetKeyInput!) {
    assetNodeOrError(assetKey: $assetKey) {
      __typename
      ... on AssetNode {
        id
        assetKey {
          path
        }
        description
        groupName
        jobNames
        kinds
        isPartitioned
        isMaterializable
        isObservable
        computeKind
        owners {
          __typename
          ... on UserAssetOwner {
            email
          }
          ... on TeamAssetOwner {
            team
          }
        }
        dependencyKeys {
          path
        }
        dependedByKeys {
          path
        }
        repository {
          name
          location {
            name
          }
        }
        assetMaterializations(limit: 3) {
          runId
          timestamp
          partition
          stepKey
        }
        freshnessStatusInfo {
          freshnessStatus
        }
      }
      ... on AssetNotFoundError {
        message
      }
    }
  }
`;
