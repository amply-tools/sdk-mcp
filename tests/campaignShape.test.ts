// tests/campaignShape.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { campaignInputShape, targetingSlot } from '../src/campaigns/shape.js';
import { buildCampaignFromTemplate } from '../src/tools/campaigns.js';

test('valid DeepLink with property filter + every-2 + appVersion parses', () => {
  const parsed = campaignInputShape.parse({
    type: 'DeepLink',
    triggering: {
      event: { name: 'ButtonTapped', type: 'custom', params: [{ name: 'name', value: 'save' }] },
      repeat: { repeatType: 'every', repeatEntity: 'event', repeatValue: [2] },
    },
    targeting: [{ appVersion: { compareType: 'greater', value: '1.0.0' } }],
    content: { url: 'stillframe://ad?type=rewarded' },
  });
  assert.equal(parsed.triggering.event.params[0]!.compareType, '==='); // default applied
  assert.deepEqual(parsed.triggering.limit, {}); // default applied
});

test('targeting item with two slots set is rejected', () => {
  assert.throws(() => targetingSlot.parse({
    appVersion: { compareType: 'greater', value: '1.0.0' },
    osVersion: { compareType: 'greater', value: '14' },
  }), /exactly one slot/);
});

test('targeting item with zero slots is rejected', () => {
  assert.throws(() => targetingSlot.parse({}), /exactly one slot/);
});

test('bad enum value is rejected', () => {
  assert.throws(() => targetingSlot.parse({ appVersion: { compareType: 'gt', value: '1' } }));
});

test('each of 5 templates builds a value that parses through campaignInputShape', () => {
  type TemplateKey = Parameters<typeof buildCampaignFromTemplate>[1];
  type TemplateParams = Parameters<typeof buildCampaignFromTemplate>[2];
  const variants: Array<[TemplateKey, TemplateParams]> = [
    ['rate-review-after-positive-moment', { event: 'PurchaseCompleted' }],
    ['deeplink-on-feature-discovery', { event: 'FeatureExplored', deeplink: 'app://upsell' }],
    ['deeplink-on-session-n', { sessionNumber: 3, deeplink: 'app://x' }],
    ['deeplink-on-custom-property', { event: 'X', customPropertyKey: 'plan', customPropertyValue: 'pro', deeplink: 'app://x' }],
    ['deeplink-after-positive-event-with-suppression', { positiveEvent: 'Y', suppressionKey: 'invited', deeplink: 'app://r' }],
  ];
  for (const [key, params] of variants) {
    const built = buildCampaignFromTemplate('test', key, params);
    // Extract only the writable fields that campaignInputShape covers.
    const writable = {
      type: built.type,
      triggering: built.triggering,
      targeting: built.targeting,
      content: built.content ?? null,
    };
    const parsed = campaignInputShape.parse(writable);
    // repeatValue must be an array (backend rejects scalars).
    assert.ok(
      Array.isArray(parsed.triggering.repeat.repeatValue),
      `${key}: repeatValue must be an array, got ${JSON.stringify(parsed.triggering.repeat.repeatValue)}`,
    );
    // DeepLink campaigns must have content.url.
    if (built.type === 'DeepLink') {
      const contentUrl = (built.content as { url?: unknown } | null | undefined)?.url;
      assert.ok(contentUrl, `${key}: DeepLink content must have url`);
    } else {
      assert.equal(built.content, null, `${key}: RateReview content must be null`);
    }
  }
});
