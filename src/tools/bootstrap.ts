import { z } from 'zod';
import { AmplyClient } from '../graphql/client.js';
import { PROJECT_CREATE, APPLICATION_CREATE } from '../graphql/mutations.js';
import { PROJECTS, APPLICATIONS } from '../graphql/queries.js';
import { AmplyError } from '../errors.js';
import { ok, safe, type CallToolResult } from './_helpers.js';

const bootstrapSchema = z.object({
  bundleId: z.string().min(1).describe('App bundle id, e.g. com.acme.app.'),
  name: z.string().min(1).describe('Human-readable application name shown in the Amply admin.'),
  platform: z.enum(['iOS', 'Android']),
  projectName: z.string().min(1).optional().describe('If supplied AND the project doesn’t already exist, it will be created. If omitted, the first available project is used.'),
});

interface ProjectsResponse {
  projects: {
    totalCount: number;
    edges: Array<{ node: { id: string; name: string } }>;
  };
}
interface ProjectCreateResponse { projectCreate: { id: string; name: string } }
interface ApplicationsResponse {
  applications: Array<{
    id: string;
    bundleId: string;
    platform: string;
    apiKeys: Array<{ public: string; lastUsed: string | null }>;
  }>;
}
interface ApplicationCreateResponse {
  applicationCreate: {
    id: string;
    bundleId: string;
    name: string;
    platform: string;
    project: { id: string; name: string };
    apiKeys: Array<{ public: string; secret: string }>;
  };
}

export function makeBootstrapForAppTool() {
  return {
    name: 'amply_bootstrap_for_app',
    description: 'One-shot: ensures a project exists, ensures an application (bundleId + platform) is registered under it, and returns the credentials (`appId`, `apiKeyPublic`, `apiKeySecret`) the SDK config needs. Idempotent for the project + application step: if the bundleId already exists, the existing application is returned (without a new key); if you also need a fresh API key, follow up with amply_create_api_key. The most useful entry point for AI agents integrating Amply into a mobile app.',
    inputSchema: bootstrapSchema,
    async handler(input: z.infer<typeof bootstrapSchema>): Promise<CallToolResult> {
      return safe(async () => {
        const client = new AmplyClient();
        const project = await ensureProject(client, input.projectName);

        const existing = await findExistingApplication(client, project.id, input.bundleId, input.platform);
        if (existing) {
          return ok({
            status: 'existing',
            project,
            application: { id: existing.id, bundleId: existing.bundleId, platform: existing.platform },
            firstApiKey: null,
            note: 'Application already exists. To get a usable apiKeySecret, call amply_create_api_key with this application id (existing api key secrets are not returned by the list endpoint).',
            envBlock: null,
          });
        }

        const created = await client.request<ApplicationCreateResponse>(APPLICATION_CREATE, {
          input: {
            bundleId: input.bundleId,
            name: input.name,
            platform: input.platform,
            project: project.id,
          },
        });
        const app = created.applicationCreate;
        const firstKey = app.apiKeys[0];
        if (!firstKey) {
          throw new AmplyError(
            'internal_error',
            'Application created but the backend returned no api key. This is a backend bug; please report.',
          );
        }

        return ok({
          status: 'created',
          project,
          application: { id: app.id, bundleId: app.bundleId, name: app.name, platform: app.platform },
          firstApiKey: { public: firstKey.public, secret: firstKey.secret },
          envBlock: renderEnvBlock(app.bundleId, firstKey.public, firstKey.secret, app.platform),
        });
      });
    },
  };
}

async function ensureProject(client: AmplyClient, projectName?: string): Promise<{ id: string; name: string }> {
  const list = await client.request<ProjectsResponse>(PROJECTS, { first: 200 });
  const all = list.projects.edges.map((e) => e.node);

  if (projectName) {
    const match = all.find((p) => p.name === projectName);
    if (match) return match;
    const created = await client.request<ProjectCreateResponse>(PROJECT_CREATE, {
      input: { name: projectName },
    });
    return created.projectCreate;
  }

  if (all.length === 0) {
    // No project name supplied and no projects yet — fail loudly so the agent knows to name one.
    throw new AmplyError(
      'validation_error',
      'No projects exist in this organization yet, and no projectName was provided.',
      { hint: 'Re-call amply_bootstrap_for_app with `projectName` set, e.g. "Default" or your app’s codename.' },
    );
  }
  if (all.length > 1) {
    throw new AmplyError(
      'validation_error',
      `Multiple projects exist (${all.length}) but no projectName was provided.`,
      { hint: 'Re-call with `projectName` set to one of: ' + all.map((p) => p.name).join(', ') },
    );
  }
  return all[0]!;
}

async function findExistingApplication(
  client: AmplyClient,
  projectId: string,
  bundleId: string,
  platform: 'iOS' | 'Android',
): Promise<ApplicationsResponse['applications'][number] | null> {
  const data = await client.request<ApplicationsResponse>(APPLICATIONS, { projectId });
  return data.applications.find((a) => a.bundleId === bundleId && a.platform === platform) ?? null;
}

function renderEnvBlock(bundleId: string, publicKey: string, secret: string, platform: string): string {
  return [
    `# Amply (${platform}). Do not commit.`,
    `EXPO_PUBLIC_AMPLY_APP_ID=${bundleId}`,
    `EXPO_PUBLIC_AMPLY_KEY_PUBLIC=${publicKey}`,
    `EXPO_PUBLIC_AMPLY_KEY_SECRET=${secret}`,
  ].join('\n');
}
