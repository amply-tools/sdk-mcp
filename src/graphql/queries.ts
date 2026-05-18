import { gql } from 'graphql-request';

/**
 * Queries against the Amply admin GraphQL. Field selections and arg shapes
 * verified against the published schema.
 */

export const ME = gql`
  query Me {
    me {
      token
      user { id email name }
      organization { id name }
    }
  }
`;

/**
 * `projects` returns `ProjectConnection!` (Relay-style pagination).
 *
 * Backend signature: `projects(pagination: PaginationInput): ProjectConnection!`.
 * PaginationInput.first defaults to 10 server-side; we ask for a larger page
 * because v1 of the MCP doesn't expose cursor pagination — the AI agent just
 * wants the list of projects to choose from.
 *
 * If a tenant ever crosses 200 projects, we'll switch to multi-page fetching.
 */
export const PROJECTS = gql`
  query Projects($first: Int, $after: String) {
    projects(pagination: { first: $first, after: $after }) {
      totalCount
      pageInfo { hasNextPage endCursor }
      edges {
        node { id name }
      }
    }
  }
`;

/**
 * `applications(projectId: UUID!)` REQUIRES projectId — no list-across-projects.
 * Returns `[Application]` (array, not a connection).
 */
export const APPLICATIONS = gql`
  query Applications($projectId: UUID!) {
    applications(projectId: $projectId) {
      id
      bundleId
      name
      platform
      project { id name }
      apiKeys { public lastUsed }
    }
  }
`;

/**
 * `application(id: UUID!)` returns one Application or null.
 *
 * We deliberately request only `apiKeys.public` and `apiKeys.lastUsed` here.
 * Fresh secrets are surfaced only by the mutation responses
 * (`apiKeyCreate` / `applicationCreate`) — the list/get path is for inventory,
 * not key retrieval.
 */
export const APPLICATION = gql`
  query Application($id: UUID!) {
    application(id: $id) {
      id
      bundleId
      name
      platform
      project { id name }
      apiKeys { public lastUsed }
    }
  }
`;
