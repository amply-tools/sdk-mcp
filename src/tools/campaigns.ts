import { z } from 'zod';
import { AmplyClient } from '../graphql/client.js';
import { CAMPAIGNS, CAMPAIGN } from '../graphql/queries.js';
import { CAMPAIGN_CREATE, CAMPAIGN_CHANGE_STATE } from '../graphql/mutations.js';
import { AmplyError } from '../errors.js';
import { ok, safe, type CallToolResult } from './_helpers.js';

/**
 * Campaign-management MCP tools. Designed conservatively — the only
 * authoring path is `amply_create_campaign_from_template` with a
 * whitelisted set of safe templates. Arbitrary campaign authoring is
 * deferred until the JSON triggering schema gets client-side validation.
 */

const stateEnum = z.enum(['Draft', 'Active', 'Cancel']);

const listSchema = z.object({
  projectId: z.string().uuid(),
  first: z.number().int().positive().max(100).optional(),
  after: z.string().optional(),
});

const getSchema = z.object({
  id: z.string().uuid(),
});

const setStateSchema = z.object({
  id: z.string().uuid(),
  state: stateEnum,
});

// Template keys + per-template params schemas
const templateKeyEnum = z.enum([
  'rate-review-after-positive-moment',
  'deeplink-on-feature-discovery',
  'deeplink-on-session-n',
  'deeplink-on-custom-property',
  'deeplink-after-positive-event-with-suppression',
]);

const createFromTemplateSchema = z.object({
  projectId: z.string().uuid(),
  name: z.string().min(1).describe('Display name for the campaign.'),
  templateKey: templateKeyEnum,
  params: z.record(z.unknown()).describe('Template-specific params. See per-template docs.'),
});

interface CampaignsResponse {
  campaigns: {
    totalCount: number;
    pageInfo: { hasNextPage: boolean; endCursor: string | null };
    edges: Array<{
      node: {
        id: string;
        name: string;
        type: string;
        state: string;
        createdAt: string;
        updatedAt: string;
      };
    }>;
  };
}

interface CampaignResponse {
  campaign: {
    id: string;
    name: string;
    type: string;
    state: string;
    project: { id: string; name: string };
    triggering: unknown;
    targeting: unknown;
    content: unknown;
    createdAt: string;
    updatedAt: string;
  } | null;
}

interface CampaignCreateResponse {
  campaignCreate: {
    id: string;
    name: string;
    type: string;
    state: string;
    project: { id: string; name: string };
    createdAt: string;
  };
}

interface CampaignChangeStateResponse {
  campaignChangeState: {
    id: string;
    name: string;
    type: string;
    state: string;
    updatedAt: string;
  };
}

export function makeListCampaignsTool() {
  return {
    name: 'amply_list_campaigns',
    description: 'List campaigns under a project (paginated). Returns id, name, type, state, createdAt, updatedAt per campaign. Read-only.',
    inputSchema: listSchema,
    async handler(input: z.infer<typeof listSchema>): Promise<CallToolResult> {
      return safe(async () => {
        const client = new AmplyClient();
        const data = await client.request<CampaignsResponse>(CAMPAIGNS, {
          projectId: input.projectId,
          first: input.first ?? 50,
          after: input.after ?? null,
        });
        return ok({
          totalCount: data.campaigns.totalCount,
          campaigns: data.campaigns.edges.map((e) => e.node),
          pageInfo: data.campaigns.pageInfo,
        });
      });
    },
  };
}

export function makeGetCampaignTool() {
  return {
    name: 'amply_get_campaign',
    description: 'Fetch one campaign by id. Returns full triggering/targeting/content JSON for inspection. Read-only.',
    inputSchema: getSchema,
    async handler(input: z.infer<typeof getSchema>): Promise<CallToolResult> {
      return safe(async () => {
        const client = new AmplyClient();
        const data = await client.request<CampaignResponse>(CAMPAIGN, { id: input.id });
        if (!data.campaign) {
          throw new AmplyError('not_found', `No campaign with id ${input.id} (or access denied).`);
        }
        return ok({ campaign: data.campaign });
      });
    },
  };
}

export function makeSetCampaignStateTool() {
  return {
    name: 'amply_set_campaign_state',
    description: 'Change campaign state to Draft / Active / Cancel. Use Cancel to pause a campaign; the campaign is not deleted. Active immediately makes the campaign live for SDK evaluation.',
    inputSchema: setStateSchema,
    async handler(input: z.infer<typeof setStateSchema>): Promise<CallToolResult> {
      return safe(async () => {
        const client = new AmplyClient();
        const data = await client.request<CampaignChangeStateResponse>(CAMPAIGN_CHANGE_STATE, {
          id: input.id,
          input: { state: input.state },
        });
        return ok({ campaign: data.campaignChangeState });
      });
    },
  };
}

/**
 * Per-template handlers. Each receives validated params (post-Zod) and
 * returns a complete CampaignInput-shaped object ready for the mutation.
 *
 * Triggering JSON conforms to backend's TriggeringInput:
 *   { event: EventInput, repeat: RepeatInput, limit: LimitInput }
 * EventInput:   { name: string, type: 'custom' | 'system', params: [] }
 * RepeatInput:  { repeatType: 'interval'|'every', repeatEntity: 'event'|'session', repeatValue: number|array }
 * LimitInput:   all-nullable optional fields (count/limit/limitType/interval/intervalDimension)
 *
 * For now we always create in Draft so the user must explicitly activate
 * via amply_set_campaign_state — extra safety net against bad auto-creates.
 */

const t1Params = z.object({
  event: z.string().min(1).describe('Event name that triggers the rate-review prompt, e.g. "PurchaseCompleted".'),
  afterNthSession: z.number().int().positive().default(3).describe('Show on the Nth session after the trigger event. Default 3.'),
});

const t2Params = z.object({
  event: z.string().min(1).describe('Event name that triggers the deeplink, e.g. "FeatureExplored".'),
  deeplink: z.string().min(1).describe('Deeplink URL the SDK will surface, e.g. "app://upsell".'),
});

const t3Params = z.object({
  sessionNumber: z.number().int().positive().describe('SessionStart count at which the deeplink fires.'),
  deeplink: z.string().min(1),
});

const t4Params = z.object({
  event: z.string().min(1).describe('Event name that triggers evaluation.'),
  customPropertyKey: z.string().min(1).describe('Custom Property key to filter by, e.g. "subscription_status".'),
  customPropertyValue: z.union([z.string(), z.number(), z.boolean()]).describe('Value to compare against.'),
  customPropertyOp: z.enum(['eq', 'neq', 'gt', 'gte', 'lt', 'lte']).default('eq'),
  deeplink: z.string().min(1),
});

const t5Params = z.object({
  positiveEvent: z.string().min(1).describe('Event that signals a positive moment (e.g. "LevelComplete", "SuccessfulShare").'),
  suppressionKey: z.string().min(1).describe('Custom Property key whose value gates the prompt, e.g. "already_invited".'),
  suppressionValue: z.union([z.string(), z.number(), z.boolean()]).default(false).describe('Value that means "already prompted, skip".'),
  intervalDays: z.number().int().positive().default(30).describe('Cooldown days between prompts for the same user.'),
  deeplink: z.string().min(1).describe('Deeplink URL to fire, e.g. "app://refer-friend".'),
});

interface CampaignInputShape {
  name: string;
  type: 'RateReview' | 'DeepLink';
  state: 'Draft' | 'Active' | 'Cancel';
  project?: string;
  triggering: {
    event: { name: string; type: 'custom' | 'system'; params: [] };
    repeat: { repeatType: 'interval' | 'every'; repeatEntity: 'event' | 'session'; repeatValue: number | number[] };
    limit: Record<string, unknown>;
  };
  targeting: Array<Record<string, unknown>>;
  content?: Record<string, unknown> | null;
}

function buildTemplate1(name: string, params: z.infer<typeof t1Params>): CampaignInputShape {
  return {
    name,
    type: 'RateReview',
    state: 'Draft',
    triggering: {
      event: { name: params.event, type: 'custom', params: [] },
      repeat: { repeatType: 'every', repeatEntity: 'session', repeatValue: params.afterNthSession },
      limit: {},
    },
    targeting: [],
    content: null,
  };
}

function buildTemplate2(name: string, params: z.infer<typeof t2Params>): CampaignInputShape {
  return {
    name,
    type: 'DeepLink',
    state: 'Draft',
    triggering: {
      event: { name: params.event, type: 'custom', params: [] },
      repeat: { repeatType: 'every', repeatEntity: 'event', repeatValue: 1 },
      limit: {},
    },
    targeting: [],
    content: { deeplink: params.deeplink },
  };
}

function buildTemplate3(name: string, params: z.infer<typeof t3Params>): CampaignInputShape {
  return {
    name,
    type: 'DeepLink',
    state: 'Draft',
    triggering: {
      // SDK constant: SystemEvents.SESSION_START = "SessionStarted" (events/Event.kt).
      event: { name: 'SessionStarted', type: 'system', params: [] },
      repeat: { repeatType: 'every', repeatEntity: 'session', repeatValue: params.sessionNumber },
      limit: {},
    },
    targeting: [],
    content: { deeplink: params.deeplink },
  };
}

function buildTemplate4(name: string, params: z.infer<typeof t4Params>): CampaignInputShape {
  return {
    name,
    type: 'DeepLink',
    state: 'Draft',
    triggering: {
      event: { name: params.event, type: 'custom', params: [] },
      repeat: { repeatType: 'every', repeatEntity: 'event', repeatValue: 1 },
      limit: {},
    },
    targeting: [
      {
        customProperty: {
          key: params.customPropertyKey,
          op: params.customPropertyOp,
          value: params.customPropertyValue,
        },
      },
    ],
    content: { deeplink: params.deeplink },
  };
}

function buildTemplate5(name: string, params: z.infer<typeof t5Params>): CampaignInputShape {
  return {
    name,
    type: 'DeepLink',
    state: 'Draft',
    triggering: {
      event: { name: params.positiveEvent, type: 'custom', params: [] },
      repeat: { repeatType: 'every', repeatEntity: 'event', repeatValue: 1 },
      limit: {
        count: 1,
        limitType: 'device',
        interval: params.intervalDays,
        intervalDimension: 'day',
      },
    },
    targeting: [
      {
        customProperty: {
          key: params.suppressionKey,
          op: 'eq',
          value: params.suppressionValue,
        },
      },
    ],
    content: { deeplink: params.deeplink },
  };
}

export function makeCreateCampaignFromTemplateTool() {
  return {
    name: 'amply_create_campaign_from_template',
    description: 'Create a campaign in Draft state from one of 5 whitelisted templates. Each template enforces a known-good triggering+targeting shape; arbitrary campaign authoring is intentionally not exposed yet. Always creates in Draft — activate via amply_set_campaign_state when ready. Templates: rate-review-after-positive-moment, deeplink-on-feature-discovery, deeplink-on-session-n, deeplink-on-custom-property, deeplink-after-positive-event-with-suppression.',
    inputSchema: createFromTemplateSchema,
    async handler(input: z.infer<typeof createFromTemplateSchema>): Promise<CallToolResult> {
      return safe(async () => {
        const client = new AmplyClient();
        const built = buildCampaignFromTemplate(input.name, input.templateKey, input.params);
        // Defense in depth — refuse if the build produced an unexpected type.
        if (built.type !== 'RateReview' && built.type !== 'DeepLink') {
          throw new AmplyError(
            'validation_error',
            `Template produced campaign type "${built.type}"; only RateReview and DeepLink are allowed.`,
          );
        }
        const payload: CampaignInputShape & { project: string } = {
          ...built,
          project: input.projectId,
        };
        const data = await client.request<CampaignCreateResponse>(CAMPAIGN_CREATE, { input: payload });
        return ok({ campaign: data.campaignCreate, templateUsed: input.templateKey });
      });
    },
  };
}

function buildCampaignFromTemplate(
  name: string,
  templateKey: z.infer<typeof templateKeyEnum>,
  params: Record<string, unknown>,
): CampaignInputShape {
  switch (templateKey) {
    case 'rate-review-after-positive-moment': {
      const v = t1Params.parse(params);
      return buildTemplate1(name, v);
    }
    case 'deeplink-on-feature-discovery': {
      const v = t2Params.parse(params);
      return buildTemplate2(name, v);
    }
    case 'deeplink-on-session-n': {
      const v = t3Params.parse(params);
      return buildTemplate3(name, v);
    }
    case 'deeplink-on-custom-property': {
      const v = t4Params.parse(params);
      return buildTemplate4(name, v);
    }
    case 'deeplink-after-positive-event-with-suppression': {
      const v = t5Params.parse(params);
      return buildTemplate5(name, v);
    }
  }
}
