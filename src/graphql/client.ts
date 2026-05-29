import { GraphQLClient } from 'graphql-request';
import { AmplyError, classifyGraphQLError } from '../errors.js';
import {
  type AmplyCredentials,
  clearCredentials,
  readCredentials,
  writeCredentials,
} from '../auth/store.js';
import { resolveEndpoint } from '../config.js';
import { REFRESH_TOKEN } from './mutations.js';

interface RefreshTokenResponse {
  refreshToken: {
    token: string;
    refreshToken: string;
    user: { id: string; email: string; name: string };
    organization: { id: string; name: string };
  };
}

/**
 * Authenticated GraphQL client.
 *
 * - Reads creds from disk on demand (no in-memory cache; MCP tools are short-lived).
 * - On `auth_required` / "JWT expired" responses, transparently refreshes once and retries.
 * - On refresh failure, clears the creds file and surfaces `auth_required`.
 *
 * Use `request()` for authenticated calls and `requestPublic()` for signup/login/refresh.
 */
export class AmplyClient {
  private readonly endpoint: string;

  constructor(endpoint = resolveEndpoint()) {
    this.endpoint = endpoint;
  }

  getEndpoint(): string {
    return this.endpoint;
  }

  /**
   * Unauthenticated request — for signup/login/refresh. Throws AmplyError on failure.
   * Default graphql-request behaviour throws ClientError when GraphQL `errors[]` is non-empty,
   * which is exactly what we want; we then map to AmplyError in classifyGraphQLError.
   */
  async requestPublic<T>(query: string, variables?: Record<string, unknown>): Promise<T> {
    const client = new GraphQLClient(this.endpoint);
    try {
      return await client.request<T>(query, variables);
    } catch (err) {
      throw classifyGraphQLError(err);
    }
  }

  /**
   * Authenticated request. Reads creds from disk, attaches Bearer, refreshes once on auth failure.
   */
  async request<T>(query: string, variables?: Record<string, unknown>): Promise<T> {
    const creds = await readCredentials();
    if (!creds) {
      throw new AmplyError('auth_required', 'No cached credentials.', {
        hint: 'Run amply_login or amply_signup first.',
      });
    }

    try {
      return await this.attempt<T>(creds.token, query, variables);
    } catch (err) {
      if (!isAuthFailure(err)) throw err;

      const refreshed = await this.tryRefresh(creds);
      if (!refreshed) {
        await clearCredentials();
        throw new AmplyError('auth_required', 'Session expired and refresh failed.', {
          hint: 'Run amply_login again.',
        });
      }
      return await this.attempt<T>(refreshed.token, query, variables);
    }
  }

  private async attempt<T>(
    token: string,
    query: string,
    variables?: Record<string, unknown>,
  ): Promise<T> {
    const client = new GraphQLClient(this.endpoint, {
      headers: { Authorization: `Bearer ${token}` },
    });
    try {
      return await client.request<T>(query, variables);
    } catch (err) {
      throw classifyGraphQLError(err);
    }
  }

  /**
   * Swaps the cached refresh token for a fresh JWT + new refresh token.
   *
   * Important: the backend ROTATES the refresh token (the old one is deleted on success).
   * If the write of the new creds file fails after the backend has rotated, the user is
   * locked out and must re-login. We use atomic file write (tmp + rename) in writeCredentials
   * to make the window as small as possible, but it is not bulletproof — flagging in README.
   */
  private async tryRefresh(creds: AmplyCredentials): Promise<AmplyCredentials | null> {
    const client = new GraphQLClient(this.endpoint);
    try {
      const data = await client.request<RefreshTokenResponse>(REFRESH_TOKEN, {
        token: creds.refreshToken,
      });
      const fresh: AmplyCredentials = {
        ...creds,
        token: data.refreshToken.token,
        refreshToken: data.refreshToken.refreshToken,
        refreshedAt: new Date().toISOString(),
        userId: data.refreshToken.user.id,
        organizationId: data.refreshToken.organization.id,
        email: data.refreshToken.user.email,
      };
      await writeCredentials(fresh);
      return fresh;
    } catch {
      return null;
    }
  }
}

/** Run an idempotent read; retry exactly once if the first failure is a network_error. */
export async function retryOnceOnNetworkError<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    const e = classifyGraphQLError(err);
    if (e.code !== 'network_error') throw e;
    return await fn();
  }
}

export function isAuthFailure(err: unknown): boolean {
  if (!(err instanceof AmplyError)) return false;
  if (err.code === 'auth_required') return true;
  // A genuinely expired access token surfaces as HTTP 401 (no GraphQL body) and is
  // classified `auth_expired`. That is the PRIMARY case the refresh-token exists for,
  // so it must trigger the silent refresh — otherwise every token expiry forces a
  // password re-login despite a valid refresh token on disk.
  if (err.code === 'auth_expired') return true;
  if (err.code === 'graphql_error' && /jwt|expired|invalid token|unauthor/i.test(err.message)) {
    return true;
  }
  return false;
}
