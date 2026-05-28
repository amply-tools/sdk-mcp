import { z } from 'zod';
import { AmplyClient, retryOnceOnNetworkError } from '../graphql/client.js';
import { PROJECT_CREATE } from '../graphql/mutations.js';
import { PROJECTS } from '../graphql/queries.js';
import { ok, safe, type CallToolResult } from './_helpers.js';

const createSchema = z.object({
  name: z.string().min(1, 'project name required'),
});

const listSchema = z.object({
  first: z.number().int().positive().max(200).optional().describe('Page size; default 50.'),
});

interface ProjectNode { id: string; name: string }
interface ProjectsResponse {
  projects: {
    totalCount: number;
    pageInfo: { hasNextPage: boolean; endCursor: string | null };
    edges: Array<{ node: ProjectNode }>;
  };
}
interface ProjectCreateResponse { projectCreate: ProjectNode }

export function makeListProjectsTool() {
  return {
    name: 'amply_list_projects',
    description: 'Lists projects in the authenticated user’s current organization. Returns up to `first` items (default 50, max 200).',
    inputSchema: listSchema,
    async handler(input: z.infer<typeof listSchema>): Promise<CallToolResult> {
      return safe(async () => {
        const client = new AmplyClient();
        const first = input.first ?? 50;
        const data = await retryOnceOnNetworkError(() => client.request<ProjectsResponse>(PROJECTS, { first }));
        return ok({
          totalCount: data.projects.totalCount,
          projects: data.projects.edges.map((e) => e.node),
          hasMore: data.projects.pageInfo.hasNextPage,
        });
      });
    },
  };
}

export function makeCreateProjectTool() {
  return {
    name: 'amply_create_project',
    description: 'Creates a new project in the authenticated user’s organization. Returns the new project’s id and name.',
    inputSchema: createSchema,
    async handler(input: z.infer<typeof createSchema>): Promise<CallToolResult> {
      return safe(async () => {
        const client = new AmplyClient();
        const data = await client.request<ProjectCreateResponse>(PROJECT_CREATE, { input });
        return ok({ project: data.projectCreate });
      });
    },
  };
}
