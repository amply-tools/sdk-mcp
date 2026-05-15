import { z } from 'zod';
import { AmplyClient } from '../graphql/client.js';
import { LOGIN, SIGNUP } from '../graphql/mutations.js';
import { ME } from '../graphql/queries.js';
import {
  clearCredentials,
  readCredentials,
  writeCredentials,
} from '../auth/store.js';
import { AmplyError, classifyGraphQLError } from '../errors.js';
import { ok, fail, safe, type CallToolResult } from './_helpers.js';

const PASSWORD_MIN = 8;

const signupSchema = z.object({
  email: z.string().email(),
  password: z.string().min(PASSWORD_MIN, `password must be at least ${PASSWORD_MIN} chars`),
  name: z.string().min(1),
  organization: z.string().min(1, 'organization name required (created with the account)'),
});

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

interface AuthPayload {
  token: string;
  refreshToken: string;
  user: { id: string; email: string; name: string };
  organization: { id: string; name: string };
}

interface SignupResponse { signup: AuthPayload }
interface LoginResponse { login: AuthPayload }
interface MeResponse { me: { user: { id: string; email: string; name: string }; organization: { id: string; name: string } } }

export function makeStatusTool() {
  return {
    name: 'amply_status',
    description: 'Reports MCP status: endpoint, whether credentials are cached, and the cached user/organization if any. Never triggers a network call.',
    inputSchema: z.object({}),
    async handler(): Promise<CallToolResult> {
      const client = new AmplyClient();
      const creds = await readCredentials();
      return ok({
        endpoint: client.getEndpoint(),
        authenticated: !!creds,
        user: creds ? { id: creds.userId, email: creds.email } : null,
        organization: creds ? { id: creds.organizationId } : null,
      });
    },
  };
}

export function makeSignupTool() {
  return {
    name: 'amply_signup',
    description: 'Creates a new Amply account and organization, then stores a session locally. Use ONCE per developer. If the email already exists, returns conflict — use amply_login instead.',
    inputSchema: signupSchema,
    async handler(input: z.infer<typeof signupSchema>): Promise<CallToolResult> {
      return safe(async () => {
        const client = new AmplyClient();
        let data: SignupResponse;
        try {
          data = await client.requestPublic<SignupResponse>(SIGNUP, { input });
        } catch (err) {
          const e = err instanceof AmplyError ? err : classifyGraphQLError(err);
          if (e.code === 'conflict' || /already exist/i.test(e.message)) {
            return fail(new AmplyError('conflict', `An account with email ${input.email} already exists.`, {
              hint: 'Run amply_login with this email and your password instead.',
            }));
          }
          return fail(e);
        }
        await persistAuth(client, data.signup);
        return ok({
          message: 'Account created. Session cached locally.',
          user: data.signup.user,
          organization: data.signup.organization,
        });
      });
    },
  };
}

export function makeLoginTool() {
  return {
    name: 'amply_login',
    description: 'Logs into an existing Amply account using email/password and caches the session locally for subsequent tool calls.',
    inputSchema: loginSchema,
    async handler(input: z.infer<typeof loginSchema>): Promise<CallToolResult> {
      return safe(async () => {
        const client = new AmplyClient();
        const data = await client.requestPublic<LoginResponse>(LOGIN, { input });
        await persistAuth(client, data.login);
        return ok({
          message: 'Logged in. Session cached locally.',
          user: data.login.user,
          organization: data.login.organization,
        });
      });
    },
  };
}

export function makeLogoutTool() {
  return {
    name: 'amply_logout',
    description: 'Clears the locally cached Amply session. Subsequent authenticated tool calls will require login.',
    inputSchema: z.object({}),
    async handler(): Promise<CallToolResult> {
      return safe(async () => {
        await clearCredentials();
        return ok({ message: 'Logged out.' });
      });
    },
  };
}

export function makeWhoamiTool() {
  return {
    name: 'amply_whoami',
    description: 'Returns the currently authenticated user and organization (calls the `me` query on the backend). Requires a cached session.',
    inputSchema: z.object({}),
    async handler(): Promise<CallToolResult> {
      return safe(async () => {
        const client = new AmplyClient();
        const data = await client.request<MeResponse>(ME);
        return ok({ user: data.me.user, organization: data.me.organization });
      });
    },
  };
}

async function persistAuth(client: AmplyClient, payload: AuthPayload): Promise<void> {
  await writeCredentials({
    endpoint: client.getEndpoint(),
    token: payload.token,
    refreshToken: payload.refreshToken,
    refreshedAt: new Date().toISOString(),
    userId: payload.user.id,
    organizationId: payload.organization.id,
    email: payload.user.email,
  });
}
