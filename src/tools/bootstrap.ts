import { z } from 'zod';
import { makeEnsureAppTool } from './ensure.js';
import type { CallToolResult } from './_helpers.js';

/**
 * Deprecated thin wrapper around amply_ensure_app. Kept so older skill
 * releases continue to work; will be removed in v0.3.0.
 *
 * Behavior preserved: implicitly mints a new key on the reuse path
 * (mintNewKey: true). Callers wanting the new reuse-without-mint behavior
 * should call amply_ensure_app directly.
 */
const bootstrapSchema = z.object({
  bundleId: z.string().min(1).describe('App bundle id, e.g. com.acme.app.'),
  name: z.string().min(1).describe('Human-readable application name shown in the Amply admin.'),
  platform: z.enum(['iOS', 'Android']),
  projectName: z.string().min(1).optional().describe('If supplied AND the project doesn’t already exist, it will be created. If omitted, the first available project is used.'),
});

export function makeBootstrapForAppTool() {
  const ensure = makeEnsureAppTool();
  return {
    name: 'amply_bootstrap_for_app',
    description:
      '[DEPRECATED — use amply_ensure_app] One-shot project+app+key resolution. Now a thin wrapper around amply_ensure_app with mintNewKey:true (preserves the old "mint on reuse" behavior). Will be removed in a future release.',
    inputSchema: bootstrapSchema,
    async handler(input: z.infer<typeof bootstrapSchema>): Promise<CallToolResult> {
      return ensure.handler({
        bundleId: input.bundleId,
        name: input.name,
        platform: input.platform,
        projectName: input.projectName,
        mintNewKey: true,
        allowDuplicateAcrossProjects: false,
      });
    },
  };
}
