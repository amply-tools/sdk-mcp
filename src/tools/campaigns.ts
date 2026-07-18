import { z } from 'zod';
import { AmplyClient, retryOnceOnNetworkError } from '../graphql/client.js';
import { CAMPAIGNS, CAMPAIGN } from '../graphql/queries.js';
import { CAMPAIGN_CREATE, CAMPAIGN_CHANGE_STATE, CAMPAIGN_EDIT } from '../graphql/mutations.js';
import { AmplyError } from '../errors.js';
import { ok, safe, type CallToolResult } from './_helpers.js';
import { campaignInputShape } from '../campaigns/shape.js';
import { buildCreateInput, shapeGetCampaign, mergeUpdateInput, validateWriteInput, type RawCampaign } from '../campaigns/transform.js';

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
  'deeplink-on-property-change',
]);

const createFromTemplateSchema = z.object({
  projectId: z.string().uuid(),
  name: z.string().min(1).describe('Display name for the campaign.'),
  templateKey: templateKeyEnum,
  params: z.record(z.unknown()).describe('Template-specific params. See per-template docs.'),
});

const createSchema = z.object({
  projectId: z.string().uuid(),
  name: z.string().min(1),
  type: z.enum(['DeepLink', 'RateReview']),
  triggering: campaignInputShape.shape.triggering,
  targeting: campaignInputShape.shape.targeting,
  content: campaignInputShape.shape.content,
});

const updateSchema = z.object({
  id: z.string().uuid(),
  name: z.string().min(1).optional(),
  state: z.enum(['Draft', 'Active', 'Cancel']).optional(),
  type: z.enum(['DeepLink', 'RateReview']).optional(),
  triggering: campaignInputShape.shape.triggering.optional(),
  targeting: campaignInputShape.shape.targeting.optional(),
  content: campaignInputShape.shape.content,
  expectedUpdatedAt: z.string().optional(),
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


interface CampaignCreateResponse {
  campaignCreate: {
    id: string;
    name: string;
    type: string;
    state: string;
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
        const data = await retryOnceOnNetworkError(() => client.request<CampaignsResponse>(CAMPAIGNS, {
          projectId: input.projectId,
          first: input.first ?? 50,
          after: input.after ?? null,
        }));
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
        const data = await retryOnceOnNetworkError(() => client.request<{ campaign: RawCampaign | null }>(CAMPAIGN, { id: input.id }));
        if (!data.campaign) throw new AmplyError('not_found', `No campaign with id ${input.id} (or access denied).`);
        return ok({ campaign: shapeGetCampaign(data.campaign) });
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
 * EventInput:   { name: string, type: 'custom' | 'system', params: EventParamInput[] }
 * EventParam:   { name: string, value: string, compareType: string ('==='), valueType: string ('string'|'number'|'boolean') }
 * RepeatInput:  { repeatType: 'interval'|'every', repeatEntity: 'event'|'session', repeatValue: number[] }
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

// Values mirror the backend's `NumberCompareType` GraphQL enum exactly. The
// short-form alternatives (eq / neq / gt / …) accepted by an earlier version
// of this tool are gone; agents calling the tool must use the long form,
// which matches the values the admin UI displays and what every other
// GraphQL consumer (frontend) already uses.
const compareTypeEnum = z.enum([
  'equal',
  'notEqual',
  'greater',
  'less',
  'greaterOrEqual',
  'lessOrEqual',
  'isNotSet',
  'isSet',
]);

const t4Params = z.object({
  event: z.string().min(1).describe('Event name that triggers evaluation.'),
  customPropertyKey: z.string().min(1).describe('Custom Property key to filter by, e.g. "subscription_status".'),
  customPropertyValue: z.union([z.string(), z.number(), z.boolean()]).describe('Value to compare against. Stringified before send (backend takes String).'),
  customPropertyCompareType: compareTypeEnum.default('equal').describe('Comparison type — backend `NumberCompareType` enum.'),
  deeplink: z.string().min(1),
});

const t5Params = z.object({
  positiveEvent: z.string().min(1).describe('Event that signals a positive moment (e.g. "LevelComplete", "SuccessfulShare").'),
  suppressionKey: z.string().min(1).describe('Custom Property key whose value gates the prompt, e.g. "already_invited".'),
  suppressionValue: z.union([z.string(), z.number(), z.boolean()]).default(false).describe('Value that means "already prompted, skip".'),
  intervalDays: z.number().int().positive().default(30).describe('Cooldown days between prompts for the same user.'),
  deeplink: z.string().min(1).describe('Deeplink URL to fire, e.g. "app://refer-friend".'),
});

const t6Params = z.object({
  propertyKey: z.string().min(1).describe('Custom Property key that changed, e.g. "subscription_status". Matched against the CustomPropertyChanged system event\'s "key" payload field.'),
  newValue: z.union([z.string(), z.number(), z.boolean()]).describe('The value the property changed TO, e.g. "expired". Matched against the event\'s "newValue".'),
  oldValue: z.union([z.string(), z.number(), z.boolean()]).optional().describe('Optional: the value the property changed FROM, for "X → Y" semantics. When set, matched against the event\'s "oldValue".'),
  deeplink: z.string().min(1).describe('Deeplink URL to fire when the change matches, e.g. "app://welcome-upgraded".'),
});

// Mirrors the backend `EventParamInput` shape (see `../campaigns/shape.ts` →
// `eventParam`): the equality operator is the literal `'==='` (not the
// targeting-side `NumberCompareType` enum), and `valueType` defaults to
// `'string'`. Only templates that filter a system/custom event by its payload
// populate this; the others pass `[]`.
interface TemplateEventParam {
  name: string;
  value: string;
  compareType: string;
  valueType: string;
}

interface LegacyTemplateInput {
  name: string;
  type: 'RateReview' | 'DeepLink';
  state: 'Draft' | 'Active' | 'Cancel';
  project?: string;
  triggering: {
    event: { name: string; type: 'custom' | 'system'; params: TemplateEventParam[] };
    repeat: { repeatType: 'interval' | 'every'; repeatEntity: 'event' | 'session'; repeatValue: number | number[] };
    limit: Record<string, unknown>;
  };
  targeting: Array<Record<string, unknown>>;
  content?: Record<string, unknown> | null;
}

function buildTemplate1(name: string, params: z.infer<typeof t1Params>): LegacyTemplateInput {
  return {
    name,
    type: 'RateReview',
    state: 'Draft',
    triggering: {
      event: { name: params.event, type: 'custom', params: [] },
      repeat: { repeatType: 'every', repeatEntity: 'session', repeatValue: [params.afterNthSession] },
      limit: {},
    },
    targeting: [],
    content: null,
  };
}

function buildTemplate2(name: string, params: z.infer<typeof t2Params>): LegacyTemplateInput {
  return {
    name,
    type: 'DeepLink',
    state: 'Draft',
    triggering: {
      event: { name: params.event, type: 'custom', params: [] },
      repeat: { repeatType: 'every', repeatEntity: 'event', repeatValue: [1] },
      limit: {},
    },
    targeting: [],
    // Backend ContentValidator expects `url`, not `deeplink`, for DeepLink content.
    content: { url: params.deeplink },
  };
}

function buildTemplate3(name: string, params: z.infer<typeof t3Params>): LegacyTemplateInput {
  return {
    name,
    type: 'DeepLink',
    state: 'Draft',
    triggering: {
      // SDK constant: SystemEvents.SESSION_START = "SessionStarted" (events/Event.kt).
      event: { name: 'SessionStarted', type: 'system', params: [] },
      repeat: { repeatType: 'every', repeatEntity: 'session', repeatValue: [params.sessionNumber] },
      limit: {},
    },
    targeting: [],
    // Backend ContentValidator expects `url`, not `deeplink`, for DeepLink content.
    content: { url: params.deeplink },
  };
}

function buildTemplate4(name: string, params: z.infer<typeof t4Params>): LegacyTemplateInput {
  return {
    name,
    type: 'DeepLink',
    state: 'Draft',
    triggering: {
      event: { name: params.event, type: 'custom', params: [] },
      repeat: { repeatType: 'every', repeatEntity: 'event', repeatValue: [1] },
      limit: {},
    },
    targeting: [
      {
        customProperty: buildCustomPropertyTargeting({
          key: params.customPropertyKey,
          compareType: params.customPropertyCompareType,
          value: params.customPropertyValue,
        }),
      },
    ],
    // Backend ContentValidator expects `url`, not `deeplink`, for DeepLink content.
    content: { url: params.deeplink },
  };
}

function buildTemplate5(name: string, params: z.infer<typeof t5Params>): LegacyTemplateInput {
  return {
    name,
    type: 'DeepLink',
    state: 'Draft',
    triggering: {
      event: { name: params.positiveEvent, type: 'custom', params: [] },
      repeat: { repeatType: 'every', repeatEntity: 'event', repeatValue: [1] },
      // LimitValidator requires limit+limitType together and interval+
      // intervalDimension together. `count` is a separate field with
      // different semantics — for the "max 1 per device per N days" intent
      // we want `limit`.
      limit: {
        limit: 1,
        limitType: 'device',
        interval: params.intervalDays,
        intervalDimension: 'day',
      },
    },
    targeting: [
      {
        customProperty: buildCustomPropertyTargeting({
          key: params.suppressionKey,
          compareType: 'equal',
          value: params.suppressionValue,
        }),
      },
    ],
    // Backend ContentValidator expects `url`, not `deeplink`, for DeepLink content.
    content: { url: params.deeplink },
  };
}

// Build a single trigger-event param filter. The backend `EventParamInput`
// carries `value` as a String, with `compareType` defaulting to the event-param
// equality operator `'==='` (distinct from the targeting-side `NumberCompareType`
// enum used by buildCustomPropertyTargeting) and `valueType` defaulting to
// `'string'`. We stringify the value and pin `valueType: 'string'` to match the
// documented `eventParam` contract (shape.ts) and `amply_describe_targeting`
// exactly — rather than reflecting the JS primitive, which would depend on
// undocumented backend coercion semantics and risk a silent non-match.
function buildEventParam(name: string, value: string | number | boolean): TemplateEventParam {
  return { name, value: String(value), compareType: '===', valueType: 'string' };
}

function buildTemplate6(name: string, params: z.infer<typeof t6Params>): LegacyTemplateInput {
  // SDK constant: SystemEvents.CUSTOM_PROPERTY_CHANGED = "CustomPropertyChanged"
  // (events/Event.kt). Auto-fired when a custom property is set/updated/removed;
  // the event payload carries { key, oldValue?, newValue?, timestamp }. We filter
  // on `key` + `newValue` (and `oldValue` when supplied) so the campaign fires
  // only on the specific transition the caller asked for.
  const eventParams: TemplateEventParam[] = [
    buildEventParam('key', params.propertyKey),
    buildEventParam('newValue', params.newValue),
  ];
  if (params.oldValue !== undefined) {
    eventParams.push(buildEventParam('oldValue', params.oldValue));
  }
  return {
    name,
    type: 'DeepLink',
    state: 'Draft',
    triggering: {
      event: { name: 'CustomPropertyChanged', type: 'system', params: eventParams },
      repeat: { repeatType: 'every', repeatEntity: 'event', repeatValue: [1] },
      limit: {},
    },
    targeting: [],
    // Backend ContentValidator expects `url`, not `deeplink`, for DeepLink content.
    content: { url: params.deeplink },
  };
}

// Shared shape builder for CustomPropertyTargetingInput. The backend's
// GraphQL input type is { key, compareType, value? } — value is optional
// because `isSet` / `isNotSet` don't use it.
function buildCustomPropertyTargeting(args: {
  key: string;
  compareType: z.infer<typeof compareTypeEnum>;
  value: string | number | boolean;
}): Record<string, unknown> {
  const out: Record<string, unknown> = {
    key: args.key,
    compareType: args.compareType,
  };
  if (args.compareType !== 'isSet' && args.compareType !== 'isNotSet') {
    out.value = String(args.value);
  }
  return out;
}

export function makeCreateCampaignFromTemplateTool() {
  return {
    name: 'amply_create_campaign_from_template',
    description: 'Create a campaign in Draft state from one of 6 whitelisted templates. Each template enforces a known-good triggering+targeting shape; arbitrary campaign authoring is intentionally not exposed yet (use amply_create_campaign for that). Always creates in Draft — activate via amply_set_campaign_state when ready. Templates: rate-review-after-positive-moment, deeplink-on-feature-discovery, deeplink-on-session-n, deeplink-on-custom-property, deeplink-after-positive-event-with-suppression, deeplink-on-property-change (fires on the CustomPropertyChanged system event — params: propertyKey, newValue, optional oldValue, deeplink).',
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
        const payload: LegacyTemplateInput & { project: string } = {
          ...built,
          project: input.projectId,
        };
        const data = await client.request<CampaignCreateResponse>(CAMPAIGN_CREATE, { input: payload });
        return ok({ campaign: data.campaignCreate, templateUsed: input.templateKey });
      });
    },
  };
}

export function buildCampaignFromTemplate(
  name: string,
  templateKey: z.infer<typeof templateKeyEnum>,
  params: Record<string, unknown>,
): LegacyTemplateInput {
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
    case 'deeplink-on-property-change': {
      const v = t6Params.parse(params);
      return buildTemplate6(name, v);
    }
  }
}

export function makeCreateCampaignTool() {
  return {
    name: 'amply_create_campaign',
    description: 'Create a campaign from a full definition (trigger event + optional property-filter params, every-N repeat cadence, device/customProperty targeting, event conditions on past behavior via eventCount/eventDate, deeplink content). ALWAYS created in Draft — activate via amply_set_campaign_state. Use amply_describe_targeting to learn the targeting vocabulary.',
    inputSchema: createSchema,
    async handler(input: z.infer<typeof createSchema>): Promise<CallToolResult> {
      return safe(async () => {
        const client = new AmplyClient();
        const payload = buildCreateInput(input.projectId, input.name, { type: input.type, triggering: input.triggering, targeting: input.targeting, content: input.content });
        const data = await client.request<CampaignCreateResponse>(CAMPAIGN_CREATE, { input: payload });
        return ok({ campaign: data.campaignCreate });
      });
    },
  };
}

export function makeUpdateCampaignTool() {
  return {
    name: 'amply_update_campaign',
    description: 'Edit an existing campaign in place. TOP-LEVEL REPLACE: any field you provide (name/state/type/triggering/targeting/content) replaces that field wholesale; a provided `targeting` array REPLACES ALL targeting rules (device slots and event conditions alike). Omitted fields keep their current value (current state is preserved — an edit never silently deactivates a live campaign). Returns the full resulting config.',
    inputSchema: updateSchema,
    async handler(input: z.infer<typeof updateSchema>): Promise<CallToolResult> {
      return safe(async () => {
        const client = new AmplyClient();
        // Read current (round-trippable shape). Throws unsupported_targeting if unreadable.
        const cur = await retryOnceOnNetworkError(() => client.request<{ campaign: RawCampaign | null }>(CAMPAIGN, { id: input.id }));
        if (!cur.campaign) throw new AmplyError('not_found', `No campaign with id ${input.id} (or access denied).`);
        const current = shapeGetCampaign(cur.campaign);
        if (input.expectedUpdatedAt && current.updatedAt && current.updatedAt !== input.expectedUpdatedAt) {
          throw new AmplyError('conflict', `Campaign changed since you read it (updatedAt ${current.updatedAt}).`, { hint: 'Re-read with amply_get_campaign and retry.' });
        }
        const merged = mergeUpdateInput(current, {
          name: input.name, state: input.state, type: input.type,
          triggering: input.triggering, targeting: input.targeting,
          content: input.content,
        });
        // Never replay unvalidated backend JSON: re-validate the writable fields.
        const validated = validateWriteInput(merged);
        await client.request(CAMPAIGN_EDIT, { id: input.id, input: { name: merged.name, state: merged.state, ...validated } });
        const after = await retryOnceOnNetworkError(() => client.request<{ campaign: RawCampaign | null }>(CAMPAIGN, { id: input.id }));
        return ok({ campaign: after.campaign ? shapeGetCampaign(after.campaign) : null });
      });
    },
  };
}

export function makeDescribeTargetingTool() {
  return {
    name: 'amply_describe_targeting',
    description: 'Describe the campaign targeting + triggering vocabulary (slots, comparators, event-property predicate shape) so it can be authored without external docs. Read-only, no network.',
    inputSchema: z.object({}),
    async handler(): Promise<CallToolResult> {
      return ok({
        targetingSlots: {
          appVersion: { shape: '{ compareType, value }', valueExample: '"1.0.0"' },
          osVersion: { shape: '{ compareType, value }' },
          appInstallVersion: { shape: '{ compareType, value }' },
          country: { shape: '{ type: include|exclude, values: [ISO country] }' },
          application: { shape: '{ type: include|exclude, values: [applicationId UUID] }' },
          customProperty: { shape: '{ key, compareType, valueType?, value?, dateValue? }' },
          installDate: { shape: '{ compareType, value: { type: absolute|relative, absoluteValue?|relativeValue?+dimension } }' },
          eventCount: {
            shape: '{ event: { name, type: custom|system, params?: [{ name, value, compareType="===", valueType="string" }] }, compareType, value: int >= 0 }',
            compareType: ['equal','notEqual','greater','less','greaterOrEqual','lessOrEqual'],
            example: 'purchased at least twice = { event: { name: "PurchaseCompleted", type: "custom" }, compareType: "greaterOrEqual", value: 2 }; never purchased = { ..., compareType: "equal", value: 0 }',
          },
          eventDate: {
            shape: '{ event, bound: first|last, mode: moreThanDaysAgo|moreThanDaysAgoOrNever|withinLastDays|beforeDate|afterDate, relativeValue (int days >= 1, relative modes) XOR absoluteValue ("YYYY-MM-DD", beforeDate/afterDate) }',
            example: 'last purchase more than 30 days ago (or never) = { event: { name: "PurchaseCompleted", type: "custom" }, bound: "last", mode: "moreThanDaysAgoOrNever", relativeValue: 30 }',
          },
        },
        note: 'Each targeting array item sets EXACTLY ONE slot. Multiple items AND together.',
        eventConditionsNote: 'Up to 20 event conditions per campaign (eventCount/eventDate items); event conditions match only apps running Amply SDK 0.6.1 or later.',
        numberCompareType: ['equal','notEqual','greater','less','greaterOrEqual','lessOrEqual','isNotSet','isSet'],
        triggering: {
          event: '{ name, type: custom|system, params: [{ name, value, compareType="===", valueType="string" }] }',
          repeat: '{ repeatType: every|interval, repeatEntity: event|session, repeatValue: number[] }',
          repeatExample: 'every 2nd matching event = { repeatType:"every", repeatEntity:"event", repeatValue:[2] } (repeatValue MUST be an array of ints)',
          limit: '{ count?, limit?, limitType?: session|device, interval?, intervalDimension?: sec|min|hour|day }',
        },
        content: { DeepLink: 'requires { url: "<deeplink>" }', RateReview: 'must be null/omitted' },
      });
    },
  };
}
