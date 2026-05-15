import { z } from 'zod';
import { AmplyClient } from '../graphql/client.js';
import { APPLICATION_CREATE } from '../graphql/mutations.js';
import { APPLICATIONS, APPLICATION } from '../graphql/queries.js';
import { AmplyError } from '../errors.js';
import { ok, safe, type CallToolResult } from './_helpers.js';

const platformSchema = z.enum(['iOS', 'Android']);

const createSchema = z.object({
  bundleId: z.string().min(1, 'bundleId required (e.g. com.example.app)'),
  name: z.string().min(1, 'human-readable application name required'),
  platform: platformSchema,
  projectId: z.string().uuid(),
});

const listSchema = z.object({
  projectId: z.string().uuid().describe('Project UUID — required by the backend; use amply_list_projects first if you need to find it.'),
});

const getSchema = z.object({
  id: z.string().uuid(),
});

interface ApiKey { public: string; secret?: string; lastUsed: string | null }
interface ApplicationNode {
  id: string;
  bundleId: string;
  name: string;
  platform: string;
  project: { id: string; name: string };
  apiKeys: ApiKey[];
}

interface ApplicationsResponse { applications: ApplicationNode[] }
interface ApplicationResponse { application: ApplicationNode | null }
interface ApplicationCreateResponse { applicationCreate: ApplicationNode }

export function makeListApplicationsTool() {
  return {
    name: 'amply_list_applications',
    description: 'Lists applications under a project. The backend REQUIRES `projectId`; if you don’t have one, call amply_list_projects first. `apiKeys[].secret` is NOT included in the list shape — use amply_get_application or amply_create_api_key to obtain a secret.',
    inputSchema: listSchema,
    async handler(input: z.infer<typeof listSchema>): Promise<CallToolResult> {
      return safe(async () => {
        const client = new AmplyClient();
        const data = await client.request<ApplicationsResponse>(APPLICATIONS, { projectId: input.projectId });
        return ok({ applications: data.applications });
      });
    },
  };
}

export function makeGetApplicationTool() {
  return {
    name: 'amply_get_application',
    description: 'Fetches a single application by UUID. Returns `public` API-key values + `lastUsed` (no `secret` — see security note below). Use this when you have the UUID and need to inspect the app metadata. For a fresh `apiKeySecret`, call `amply_create_api_key` instead.',
    inputSchema: getSchema,
    async handler(input: z.infer<typeof getSchema>): Promise<CallToolResult> {
      return safe(async () => {
        const client = new AmplyClient();
        const data = await client.request<ApplicationResponse>(APPLICATION, { id: input.id });
        if (!data.application) {
          throw new AmplyError('not_found', `No application with id ${input.id} (or access denied).`);
        }
        return ok({ application: data.application });
      });
    },
  };
}

export function makeCreateApplicationTool() {
  return {
    name: 'amply_create_application',
    description: 'Registers a new application (iOS or Android) under a project. The first API key is generated automatically by the backend and returned in the response. Returns conflict if (bundleId, platform) is already registered.',
    inputSchema: createSchema,
    async handler(input: z.infer<typeof createSchema>): Promise<CallToolResult> {
      return safe(async () => {
        const client = new AmplyClient();
        const data = await client.request<ApplicationCreateResponse>(APPLICATION_CREATE, {
          input: {
            bundleId: input.bundleId,
            name: input.name,
            platform: input.platform,
            project: input.projectId,
          },
        });
        const app = data.applicationCreate;
        const firstKey = app.apiKeys[0];
        return ok({
          application: { id: app.id, bundleId: app.bundleId, name: app.name, platform: app.platform, project: app.project },
          firstApiKey: firstKey ? { public: firstKey.public, secret: firstKey.secret } : null,
        });
      });
    },
  };
}
