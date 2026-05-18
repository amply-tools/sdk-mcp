import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  makeListCampaignsTool,
  makeGetCampaignTool,
  makeSetCampaignStateTool,
  makeCreateCampaignFromTemplateTool,
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

test('amply_create_campaign_from_template — accepts all 5 templates', () => {
  const t = makeCreateCampaignFromTemplateTool();
  const cases: Array<[string, Record<string, unknown>]> = [
    ['rate-review-after-positive-moment', { event: 'PurchaseCompleted' }],
    ['deeplink-on-feature-discovery', { event: 'FeatureExplored', deeplink: 'app://x' }],
    ['deeplink-on-session-n', { sessionNumber: 5, deeplink: 'app://x' }],
    ['deeplink-on-custom-property', { event: 'SessionStart', customPropertyKey: 'is_premium', customPropertyValue: true, deeplink: 'app://x' }],
    ['deeplink-after-positive-event-with-suppression', { positiveEvent: 'LevelComplete', suppressionKey: 'already_invited', deeplink: 'app://x' }],
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
