import { gql } from 'graphql-request';

/**
 * Mutations against the Amply admin GraphQL. Field selections and arg shapes
 * verified against the published schema.
 */

export const SIGNUP = gql`
  mutation Signup($input: RegistrationUserInput!) {
    signup(input: $input) {
      token
      refreshToken
      user { id email name }
      organization { id name }
    }
  }
`;

export const LOGIN = gql`
  mutation Login($input: LoginInput!) {
    login(input: $input) {
      token
      refreshToken
      user { id email name }
      organization { id name }
    }
  }
`;

/**
 * Refresh handler takes top-level `token: String!`, not an input object.
 * Backend rotates the refresh token: old one is invalidated on success.
 */
export const REFRESH_TOKEN = gql`
  mutation RefreshToken($token: String!) {
    refreshToken(token: $token) {
      token
      refreshToken
      user { id email name }
      organization { id name }
    }
  }
`;

export const PROJECT_CREATE = gql`
  mutation ProjectCreate($input: ProjectInput!) {
    projectCreate(input: $input) {
      id
      name
    }
  }
`;

/**
 * applicationCreate auto-creates the first ApiKey internally; we request the
 * `apiKeys` selection so the caller can paste the public/secret values into
 * `.env.local` without a follow-up apiKeyCreate call.
 */
export const APPLICATION_CREATE = gql`
  mutation ApplicationCreate($input: ApplicationInput!) {
    applicationCreate(input: $input) {
      id
      bundleId
      name
      platform
      project { id name }
      apiKeys { public secret lastUsed }
    }
  }
`;

/**
 * apiKeyCreate takes top-level `application: UUID!`, NOT a wrapped input.
 */
export const API_KEY_CREATE = gql`
  mutation ApiKeyCreate($application: UUID!) {
    apiKeyCreate(application: $application) {
      public
      secret
      lastUsed
      application { id bundleId name platform }
    }
  }
`;

/**
 * campaignCreate(input: CampaignInput!): Campaign
 *
 * CampaignInput required fields: name (String!), type (CampaignType!),
 * targeting ([TargetingInput!]), triggering (TriggeringInput!).
 * Optional: state, project, content (JSON).
 */
export const CAMPAIGN_CREATE = gql`
  mutation CampaignCreate($input: CampaignInput!) {
    campaignCreate(input: $input) {
      id
      name
      type
      state
      project { id name }
      createdAt
    }
  }
`;

/**
 * campaignChangeState(id: UUID!, input: CampaignStateInput!): Campaign
 * CampaignStateInput is just { state: CampaignState! }.
 */
export const CAMPAIGN_CHANGE_STATE = gql`
  mutation CampaignChangeState($id: UUID!, $input: CampaignStateInput!) {
    campaignChangeState(id: $id, input: $input) {
      id
      name
      type
      state
      updatedAt
    }
  }
`;
