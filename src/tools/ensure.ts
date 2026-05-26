import { z } from 'zod';
import { AmplyClient } from '../graphql/client.js';
import { APPLICATION_CREATE, API_KEY_CREATE, PROJECT_CREATE } from '../graphql/mutations.js';
import { AmplyError } from '../errors.js';
import { ok, safe, type CallToolResult } from './_helpers.js';
import {
  findApplicationsByBundle,
  listAllProjects,
} from './applications.js';

const ensureSchema = z.object({
  bundleId: z.string().min(1).describe('App bundle id, e.g. com.acme.app.'),
  name: z.string().min(1).describe('Human-readable application name shown in the Amply admin.'),
  platform: z.enum(['iOS', 'Android']),
  projectName: z.string().min(1).optional().describe('If supplied: looked up by name; created if absent. If omitted: uses the oldest existing project (and creates "Default project" if the org has none).'),
  mintNewKey: z.boolean().optional().describe('If true and the application already exists, mint a fresh API key (otherwise the existing app is returned without a usable secret — the list endpoint does not expose secrets).'),
  allowDuplicateAcrossProjects: z.boolean().optional().describe('If false (default): refuse with status `conflict_cross_project` when bundleId+platform already exists in a different project. If true: allow registering a duplicate under the resolved project.'),
});

export type EnsureAppInput = z.infer<typeof ensureSchema>;

interface ProjectShape { id: string; name: string }
interface ProjectCreateResponse { projectCreate: ProjectShape }
interface AppCreateResponse {
  applicationCreate: {
    id: string;
    bundleId: string;
    name: string;
    platform: string;
    project: ProjectShape;
    apiKeys: Array<{ public: string; secret: string; lastUsed: string | null }>;
  };
}
interface ApiKeyCreateResponse {
  apiKeyCreate: {
    public: string;
    secret: string;
    lastUsed: string | null;
    application: { id: string; bundleId: string; name: string; platform: string };
  };
}

const SECRET_PLACEHOLDER = '<paste from Amply admin>';

export function makeEnsureAppTool() {
  return {
    name: 'amply_ensure_app',
    description:
      'Idempotent project + application + key resolution. Finds-or-creates a project (sorted deterministically when many exist), discovers any existing application by bundleId+platform, and decides whether to reuse, mint a new key for the reused app, create fresh, or fail with a cross-project conflict. Returns a structured `status` (`created`, `reused`, `reused_new_key`, `conflict_cross_project`) plus an `envBlock` ready to paste into a .env file. Prefer this over amply_bootstrap_for_app.',
    inputSchema: ensureSchema,
    async handler(input: EnsureAppInput): Promise<CallToolResult> {
      return safe(async () => {
        const client = new AmplyClient();

        // 1. Resolve project (find-or-create).
        const { project, projectCreated, projectWarning } = await resolveProject(client, input.projectName);

        // 2. Cross-project guard. Scan every project to detect existing
        //    matches anywhere in the org; refuse silent duplicates.
        const allMatches = await findApplicationsByBundle(client, input.bundleId, input.platform);
        const inResolvedProject = allMatches.find((m) => m.projectId === project.id);
        const outsideResolvedProject = allMatches.filter((m) => m.projectId !== project.id);

        if (outsideResolvedProject.length > 0 && !input.allowDuplicateAcrossProjects && !inResolvedProject) {
          const other = outsideResolvedProject[0]!;
          return ok({
            status: 'conflict_cross_project',
            existingApplicationProject: {
              id: other.projectId,
              name: other.application.project.name,
            },
            existingApplication: {
              id: other.application.id,
              bundleId: other.application.bundleId,
              platform: other.application.platform,
            },
            hint:
              'This bundleId+platform is registered in a different project. ' +
              'Either pass `projectName` matching the existing project, or set `allowDuplicateAcrossProjects: true` to register a separate app under the resolved project.',
            projectCreated,
            projectWarning,
          });
        }

        // 3. Reuse / mint / create.
        if (inResolvedProject) {
          if (!input.mintNewKey) {
            return ok({
              status: 'reused',
              project,
              projectCreated,
              projectWarning,
              application: shrinkApp(inResolvedProject.application),
              firstApiKey: null,
              envBlock: renderEnvBlock({
                appId: inResolvedProject.application.id,
                publicKey: SECRET_PLACEHOLDER,
                secret: SECRET_PLACEHOLDER,
                platform: inResolvedProject.application.platform,
              }),
              hint:
                'Existing application reused. The list endpoint does not expose secrets — ' +
                're-invoke with `mintNewKey: true` to get a usable secret, or paste an existing key from the Amply admin.',
            });
          }
          const minted = await client.request<ApiKeyCreateResponse>(API_KEY_CREATE, {
            application: inResolvedProject.application.id,
          });
          return ok({
            status: 'reused_new_key',
            project,
            projectCreated,
            projectWarning,
            application: shrinkApp(inResolvedProject.application),
            firstApiKey: { public: minted.apiKeyCreate.public, secret: minted.apiKeyCreate.secret },
            envBlock: renderEnvBlock({
              appId: inResolvedProject.application.id,
              publicKey: minted.apiKeyCreate.public,
              secret: minted.apiKeyCreate.secret,
              platform: inResolvedProject.application.platform,
            }),
          });
        }

        // No existing match in resolved project — create fresh.
        const created = await client.request<AppCreateResponse>(APPLICATION_CREATE, {
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
          projectCreated,
          projectWarning,
          application: { id: app.id, bundleId: app.bundleId, name: app.name, platform: app.platform },
          firstApiKey: { public: firstKey.public, secret: firstKey.secret },
          envBlock: renderEnvBlock({
            appId: app.id,
            publicKey: firstKey.public,
            secret: firstKey.secret,
            platform: app.platform,
          }),
        });
      });
    },
  };
}

interface ProjectResolution {
  project: ProjectShape;
  projectCreated: boolean;
  projectWarning: string | null;
}

/**
 * Project resolution policy:
 * - If `projectName` is provided: look it up; create if absent (projectCreated=true).
 * - If not: list all projects deterministically (id asc, since createdAt isn't on the wire here);
 *   if 0 → create "Default project"; if 1 → use it; if 2+ → use oldest with a warning.
 */
async function resolveProject(client: AmplyClient, projectName?: string): Promise<ProjectResolution> {
  if (projectName) {
    const all = await listAllProjects(client);
    const match = all.find((p) => p.name === projectName);
    if (match) {
      return { project: match, projectCreated: false, projectWarning: null };
    }
    const created = await client.request<ProjectCreateResponse>(PROJECT_CREATE, {
      input: { name: projectName },
    });
    return { project: created.projectCreate, projectCreated: true, projectWarning: null };
  }

  const all = await listAllProjects(client);
  const sorted = [...all].sort((a, b) => a.id.localeCompare(b.id));

  if (sorted.length === 0) {
    const created = await client.request<ProjectCreateResponse>(PROJECT_CREATE, {
      input: { name: 'Default project' },
    });
    return { project: created.projectCreate, projectCreated: true, projectWarning: null };
  }

  if (sorted.length === 1) {
    return { project: sorted[0]!, projectCreated: false, projectWarning: null };
  }

  return {
    project: sorted[0]!,
    projectCreated: false,
    projectWarning: `Multiple projects exist (${sorted.length}); resolved to "${sorted[0]!.name}" by sort. Pass projectName to disambiguate.`,
  };
}

function shrinkApp(a: { id: string; bundleId: string; name: string; platform: string; project: ProjectShape }) {
  return { id: a.id, bundleId: a.bundleId, name: a.name, platform: a.platform };
}

interface EnvBlockArgs { appId: string; publicKey: string; secret: string; platform: string }

// The MCP can't tell native iOS from RN-iOS (both register as `platform: 'iOS'`).
// We emit the canonical block per platform with a one-line note pointing at the
// RN-flavour variant when relevant. The caller (skill / agent) picks the form
// that matches their project type detected in skill Phase 1.
export function renderEnvBlock({ appId, publicKey, secret, platform }: EnvBlockArgs): string {
  // The historical block (active EXPO_PUBLIC_* lines) is kept as the default
  // so existing RN/Expo automation that consumed .env files keeps working.
  // The platform-native variant is added as a commented block — native iOS /
  // Android integrators uncomment that and remove the EXPO_PUBLIC_* lines.
  if (platform === 'iOS') {
    return [
      `# Amply (iOS). Do not commit.`,
      `# RN/Expo (default — active):`,
      `EXPO_PUBLIC_AMPLY_APP_ID=${appId}`,
      `EXPO_PUBLIC_AMPLY_KEY_PUBLIC=${publicKey}`,
      `EXPO_PUBLIC_AMPLY_KEY_SECRET=${secret}`,
      `# Native Swift (uncomment and remove the EXPO_PUBLIC_* block above if you have a pure Swift project):`,
      `# AMPLY_APP_ID=${appId}`,
      `# AMPLY_KEY_PUBLIC=${publicKey}`,
      `# AMPLY_KEY_SECRET=${secret}`,
    ].join('\n');
  }
  if (platform === 'Android') {
    return [
      `# Amply (Android). Do not commit.`,
      `# RN (default — active):`,
      `EXPO_PUBLIC_AMPLY_APP_ID=${appId}`,
      `EXPO_PUBLIC_AMPLY_KEY_PUBLIC=${publicKey}`,
      `EXPO_PUBLIC_AMPLY_KEY_SECRET=${secret}`,
      `# Native Kotlin (uncomment in local.properties → BuildConfig field if you have a pure Kotlin project):`,
      `# amply.appId=${appId}`,
      `# amply.keyPublic=${publicKey}`,
      `# amply.keySecret=${secret}`,
    ].join('\n');
  }
  // Fallback — historical RN-flavoured output for any unknown platform.
  return [
    `# Amply (${platform}). Do not commit.`,
    `EXPO_PUBLIC_AMPLY_APP_ID=${appId}`,
    `EXPO_PUBLIC_AMPLY_KEY_PUBLIC=${publicKey}`,
    `EXPO_PUBLIC_AMPLY_KEY_SECRET=${secret}`,
  ].join('\n');
}
