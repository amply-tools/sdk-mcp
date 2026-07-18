import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  makeListCampaignsTool,
  makeGetCampaignTool,
  makeSetCampaignStateTool,
  makeCreateCampaignFromTemplateTool,
  makeCreateCampaignTool,
  makeUpdateCampaignTool,
  makeDescribeTargetingTool,
  buildCampaignFromTemplate,
} from '../src/tools/campaigns.js';

test('amply_list_campaigns — metadata + schema', () => {
  const t = makeListCampaignsTool();
  assert.equal(t.name, 'amply_list_campaigns');
  assert.equal(
    t.inputSchema.safeParse({ projectId: '00000000-0000-0000-0000-000000000000' }).success,
    true,
  );
  assert.equal(t.inputSchema.safeParse({ projectId: 'not-a-uuid' }).success, false);
});

test('amply_get_campaign — schema', () => {
  const t = makeGetCampaignTool();
  assert.equal(t.inputSchema.safeParse({ id: '00000000-0000-0000-0000-000000000000' }).success, true);
  assert.equal(t.inputSchema.safeParse({ id: 'bad' }).success, false);
});

test('amply_set_campaign_state — schema accepts the three valid states', () => {
  const t = makeSetCampaignStateTool();
  for (const state of ['Draft', 'Active', 'Cancel'] as const) {
    assert.equal(
      t.inputSchema.safeParse({ id: '00000000-0000-0000-0000-000000000000', state }).success,
      true,
      `expected ${state} to be accepted`,
    );
  }
  assert.equal(
    t.inputSchema.safeParse({ id: '00000000-0000-0000-0000-000000000000', state: 'Paused' }).success,
    false,
  );
});

test('amply_create_campaign_from_template — rejects unknown template', () => {
  const t = makeCreateCampaignFromTemplateTool();
  const r = t.inputSchema.safeParse({
    projectId: '00000000-0000-0000-0000-000000000000',
    name: 'Test',
    templateKey: 'no-such-template',
    params: {},
  });
  assert.equal(r.success, false);
});

test('amply_create_campaign_from_template — accepts deeplink-on-session-n', () => {
  const t = makeCreateCampaignFromTemplateTool();
  const r = t.inputSchema.safeParse({
    projectId: '00000000-0000-0000-0000-000000000000',
    name: 'Paywall every 3rd session',
    templateKey: 'deeplink-on-session-n',
    params: { sessionNumber: 3, deeplink: 'app://paywall' },
  });
  assert.equal(r.success, true);
});

test('amply_create_campaign_from_template — accepts all 6 templates', () => {
  const t = makeCreateCampaignFromTemplateTool();
  const cases: Array<[string, Record<string, unknown>]> = [
    ['rate-review-after-positive-moment', { event: 'PurchaseCompleted' }],
    ['deeplink-on-feature-discovery', { event: 'FeatureExplored', deeplink: 'app://x' }],
    ['deeplink-on-session-n', { sessionNumber: 5, deeplink: 'app://x' }],
    ['deeplink-on-custom-property', { event: 'SessionStart', customPropertyKey: 'is_premium', customPropertyValue: true, deeplink: 'app://x' }],
    ['deeplink-after-positive-event-with-suppression', { positiveEvent: 'LevelComplete', suppressionKey: 'already_invited', deeplink: 'app://x' }],
    ['deeplink-on-property-change', { propertyKey: 'subscription_status', newValue: 'expired', deeplink: 'app://x' }],
  ];
  for (const [key, params] of cases) {
    const r = t.inputSchema.safeParse({
      projectId: '00000000-0000-0000-0000-000000000000',
      name: `Test ${key}`,
      templateKey: key,
      params,
    });
    assert.equal(r.success, true, `template ${key} should validate at the outer schema`);
  }
});

test('deeplink-on-session-n — builds a SessionStarted trigger with repeatEntity event', () => {
  const built = buildCampaignFromTemplate('Paywall on session 3', 'deeplink-on-session-n', {
    sessionNumber: 3,
    deeplink: 'app://paywall',
  });
  assert.equal(built.triggering.event.name, 'SessionStarted');
  assert.equal(built.triggering.event.type, 'system');
  // Backend rejects repeatEntity 'session' for SessionStarted ("Event
  // 'SessionStarted' requires repeatEntity to be 'event'"). Counting
  // SessionStarted events IS counting sessions, so 'event' is semantically
  // identical for this trigger.
  assert.deepEqual(built.triggering.repeat, {
    repeatType: 'every',
    repeatEntity: 'event',
    repeatValue: [3],
  });
  assert.deepEqual(built.content, { url: 'app://paywall' });
});

test('deeplink-on-property-change — builds the CustomPropertyChanged trigger shape', () => {
  const built = buildCampaignFromTemplate('Trial expired recovery', 'deeplink-on-property-change', {
    propertyKey: 'subscription_status',
    newValue: 'expired',
    oldValue: 'trial',
    deeplink: 'app://recover',
  });

  assert.equal(built.type, 'DeepLink');
  assert.equal(built.state, 'Draft');
  // Triggers off the SDK system event, not a custom app event.
  assert.equal(built.triggering.event.name, 'CustomPropertyChanged');
  assert.equal(built.triggering.event.type, 'system');
  // Event-param filters: key + newValue + oldValue, using the '===' operator.
  assert.deepEqual(built.triggering.event.params, [
    { name: 'key', value: 'subscription_status', compareType: '===', valueType: 'string' },
    { name: 'newValue', value: 'expired', compareType: '===', valueType: 'string' },
    { name: 'oldValue', value: 'trial', compareType: '===', valueType: 'string' },
  ]);
  // Backend ContentValidator expects `url`, not `deeplink`.
  assert.deepEqual(built.content, { url: 'app://recover' });
  // No device/customProperty targeting — the trigger itself carries the filter.
  assert.deepEqual(built.targeting, []);
});

test('amply_describe_targeting — documents the event-history condition slots', async () => {
  const t = makeDescribeTargetingTool();
  const result = await t.handler();
  const first = result.content[0] as { type: 'text'; text: string };
  const body = JSON.parse(first.text) as {
    targetingSlots: Record<string, unknown>;
    eventConditionsNote?: string;
  };
  assert.ok(body.targetingSlots.eventCount, 'eventCount slot must be described');
  assert.ok(body.targetingSlots.eventDate, 'eventDate slot must be described');
  const eventDateShape = JSON.stringify(body.targetingSlots.eventDate);
  for (const mode of ['moreThanDaysAgo', 'moreThanDaysAgoOrNever', 'withinLastDays', 'beforeDate', 'afterDate']) {
    assert.match(eventDateShape, new RegExp(mode), `eventDate description must list mode ${mode}`);
  }
  // The cap + SDK floor note agents must see before authoring event conditions.
  assert.match(body.eventConditionsNote ?? '', /up to 20 event conditions per campaign/i);
  assert.match(body.eventConditionsNote ?? '', /Amply SDK 0\.6\.1 or later/);
  // eventCount must NOT advertise isSet/isNotSet.
  const eventCountShape = JSON.stringify(body.targetingSlots.eventCount);
  assert.doesNotMatch(eventCountShape, /isSet|isNotSet/);
});

test('amply_describe_targeting — exposes the eventParam compareType/valueType vocabularies', async () => {
  const t = makeDescribeTargetingTool();
  const result = await t.handler();
  const first = result.content[0] as { type: 'text'; text: string };
  const body = JSON.parse(first.text) as {
    triggering: { eventParamCompareType?: string[]; eventParamValueType?: string[] };
  };
  assert.deepEqual(body.triggering.eventParamCompareType, ['===', '!==', '>', '>=', '<', '<=']);
  assert.deepEqual(body.triggering.eventParamValueType, ['string', 'number', 'boolean']);
});

test('create/update tool descriptions mention event conditions', () => {
  assert.match(makeCreateCampaignTool().description, /event condition/i);
  assert.match(makeUpdateCampaignTool().description, /event condition/i);
});

test('deeplink-on-property-change — omits oldValue param when not supplied; stringifies non-string values', () => {
  const built = buildCampaignFromTemplate('Upgraded welcome', 'deeplink-on-property-change', {
    propertyKey: 'total_purchases',
    newValue: 5,
    deeplink: 'app://welcome',
  });
  // Non-string values are stringified; valueType stays 'string' to match the
  // documented eventParam contract (no dependency on backend type coercion).
  assert.deepEqual(built.triggering.event.params, [
    { name: 'key', value: 'total_purchases', compareType: '===', valueType: 'string' },
    { name: 'newValue', value: '5', compareType: '===', valueType: 'string' },
  ]);
});
