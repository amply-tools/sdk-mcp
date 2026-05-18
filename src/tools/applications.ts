import { z } from 'zod';
import { AmplyClient } from '../graphql/client.js';
import { APPLICATION_CREATE } from '../graphql/mutations.js';
import { APPLICATIONS, APPLICATION, PROJECTS } from '../graphql/queries.js';
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

const findSchema = z.object({
  bundleId: z.string().min(1, 'bundleId required (e.g. com.example.app)'),
  platform: platformSchema,
  projectId: z.string().uuid().optional().describe('Scope to a single project. If omitted, scans every project in the organization (paginated).'),
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
interface ProjectsResponse {
  projects: {
    totalCount: number;
    pageInfo: { hasNextPage: boolean; endCursor: string | null };
    edges: Array<{ node: { id: string; name: string } }>;
  };
}

/**
 * Paginate through every project the org owner can see.
 * Used by tools that need to scan applications across all projects
 * (find_application without projectId, ensure_app cross-project guard).
 */
export async function listAllProjects(client: AmplyClient): Promise<Array<{ id: string; name: string }>> {
  const out: Array<{ id: string; name: string }> = [];
  let after: string | null = null;
  // Hard cap pages to avoid runaway loops on a buggy backend.
  for (let i = 0; i < 100; i++) {
    const data: ProjectsResponse = await client.request<ProjectsResponse>(PROJECTS, { first: 50, after });
    out.push(...data.projects.edges.map((e) => e.node));
    if (!data.projects.pageInfo.hasNextPage) return out;
    after = data.projects.pageInfo.endCursor;
    if (!after) return out;
  }
  return out;
}

/**
 * List all applications in a project. The backend `applications(projectId)`
 * is an unpaginated array, so this is a single round-trip.
 */
export async function listApplicationsInProject(client: AmplyClient, projectId: string): Promise<ApplicationNode[]> {
  const data = await client.request<ApplicationsResponse>(APPLICATIONS, { projectId });
  return data.applications;
}

/**
 * Find every application matching (bundleId, platform) across one or all projects.
 * Returns matches sorted with the resolvedProject (if given) first.
 */
export async function findApplicationsByBundle(
  client: AmplyClient,
  bundleId: string,
  platform: 'iOS' | 'Android',
  projectId?: string,
): Promise<Array<{ application: ApplicationNode; projectId: string }>> {
  const projects = projectId ? [{ id: projectId, name: '<scoped>' }] : await listAllProjects(client);
  const out: Array<{ application: ApplicationNode; projectId: string }> = [];
  for (const p of projects) {
    const apps = await listApplicationsInProject(client, p.id);
    for (const a of apps) {
      if (a.bundleId === bundleId && a.platform === platform) {
        out.push({ application: a, projectId: p.id });
      }
    }
  }
  return out;
}

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

export function makeFindApplicationTool() {
  return {
    name: 'amply_find_application',
    description: 'Find an existing application by bundleId + platform. Returns the application (without secrets) plus its owning project, or null if none found. If `projectId` is supplied, scoped to that project; otherwise scans every project in the org (paginated). Pure read — no side effects. Use this in a skill preflight before deciding to create.',
    inputSchema: findSchema,
    async handler(input: z.infer<typeof findSchema>): Promise<CallToolResult> {
      return safe(async () => {
        const client = new AmplyClient();
        const matches = await findApplicationsByBundle(client, input.bundleId, input.platform, input.projectId);
        if (matches.length === 0) {
          return ok({ found: false, application: null, duplicates: [] });
        }
        const first = matches[0]!;
        return ok({
          found: true,
          application: {
            id: first.application.id,
            bundleId: first.application.bundleId,
            name: first.application.name,
            platform: first.application.platform,
            project: first.application.project,
          },
          duplicates: matches.slice(1).map((m) => ({
            applicationId: m.application.id,
            projectId: m.projectId,
            projectName: m.application.project.name,
          })),
        });
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
