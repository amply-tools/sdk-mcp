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

// --- Event-history condition slots (0.5.0) ---

test('eventCount slot with event params parses; params defaults applied', () => {
  const parsed = targetingSlot.parse({
    eventCount: {
      event: { name: 'PurchaseCompleted', type: 'custom', params: [{ name: 'product', value: 'pro' }] },
      compareType: 'greaterOrEqual',
      value: 2,
    },
  });
  assert.equal(parsed.eventCount?.event.params[0]?.compareType, '==='); // eventParam default applied
  assert.equal(parsed.eventCount?.event.params[0]?.valueType, 'string');
});

test('eventCount slot without params parses (params default to [])', () => {
  const parsed = targetingSlot.parse({
    eventCount: { event: { name: 'AppOpened', type: 'custom' }, compareType: 'equal', value: 0 },
  });
  assert.deepEqual(parsed.eventCount?.event.params, []);
});

test('eventCount rejects isSet/isNotSet compareType', () => {
  for (const compareType of ['isSet', 'isNotSet']) {
    assert.throws(
      () => targetingSlot.parse({
        eventCount: { event: { name: 'X', type: 'custom' }, compareType, value: 1 },
      }),
      Error,
      `${compareType} must be rejected for eventCount`,
    );
  }
});

test('eventCount value must be a non-negative integer', () => {
  const base = { event: { name: 'X', type: 'custom' }, compareType: 'equal' };
  assert.throws(() => targetingSlot.parse({ eventCount: { ...base, value: -1 } }));
  assert.throws(() => targetingSlot.parse({ eventCount: { ...base, value: 1.5 } }));
  assert.ok(targetingSlot.parse({ eventCount: { ...base, value: 0 } }));
});

test('eventDate relative modes require relativeValue and forbid absoluteValue', () => {
  for (const mode of ['moreThanDaysAgo', 'moreThanDaysAgoOrNever', 'withinLastDays']) {
    const base = { event: { name: 'X', type: 'custom' }, bound: 'first', mode };
    // Valid: relativeValue only.
    assert.ok(targetingSlot.parse({ eventDate: { ...base, relativeValue: 7 } }));
    // Missing relativeValue rejected.
    assert.throws(() => targetingSlot.parse({ eventDate: base }), Error, `${mode} without relativeValue`);
    // absoluteValue alongside rejected (XOR).
    assert.throws(
      () => targetingSlot.parse({ eventDate: { ...base, relativeValue: 7, absoluteValue: '2026-07-01' } }),
      Error,
      `${mode} with absoluteValue`,
    );
  }
});

test('eventDate absolute modes require absoluteValue and forbid relativeValue', () => {
  for (const mode of ['beforeDate', 'afterDate']) {
    const base = { event: { name: 'X', type: 'custom' }, bound: 'last', mode };
    assert.ok(targetingSlot.parse({ eventDate: { ...base, absoluteValue: '2026-07-01' } }));
    assert.throws(() => targetingSlot.parse({ eventDate: base }), Error, `${mode} without absoluteValue`);
    assert.throws(
      () => targetingSlot.parse({ eventDate: { ...base, absoluteValue: '2026-07-01', relativeValue: 7 } }),
      Error,
      `${mode} with relativeValue`,
    );
  }
});

test('eventDate relativeValue must be >= 1; absoluteValue must be YYYY-MM-DD', () => {
  const base = { event: { name: 'X', type: 'custom' }, bound: 'first' };
  assert.throws(() => targetingSlot.parse({ eventDate: { ...base, mode: 'withinLastDays', relativeValue: 0 } }));
  assert.throws(() => targetingSlot.parse({ eventDate: { ...base, mode: 'beforeDate', absoluteValue: '07/01/2026' } }));
  assert.throws(() => targetingSlot.parse({ eventDate: { ...base, mode: 'beforeDate', absoluteValue: '2026-7-1' } }));
});

test('event slots still respect the exactly-one-slot refine', () => {
  assert.throws(() => targetingSlot.parse({
    eventCount: { event: { name: 'X', type: 'custom' }, compareType: 'equal', value: 1 },
    appVersion: { compareType: 'greater', value: '1.0.0' },
  }), /exactly one slot/);
  assert.throws(() => targetingSlot.parse({
    eventCount: { event: { name: 'X', type: 'custom' }, compareType: 'equal', value: 1 },
    eventDate: { event: { name: 'X', type: 'custom' }, bound: 'first', mode: 'withinLastDays', relativeValue: 7 },
  }), /exactly one slot/);
});

test('campaignInputShape accepts a campaign mixing device and event-history targeting', () => {
  const parsed = campaignInputShape.parse({
    type: 'DeepLink',
    triggering: {
      event: { name: 'SessionStarted', type: 'system', params: [] },
      repeat: { repeatType: 'every', repeatEntity: 'session', repeatValue: [1] },
    },
    targeting: [
      { appVersion: { compareType: 'greaterOrEqual', value: '2.0.0' } },
      { eventCount: { event: { name: 'PaywallShown', type: 'custom' }, compareType: 'less', value: 3 } },
      { eventDate: { event: { name: 'PurchaseCompleted', type: 'custom' }, bound: 'last', mode: 'moreThanDaysAgoOrNever', relativeValue: 30 } },
    ],
    content: { url: 'app://paywall' },
  });
  assert.equal(parsed.targeting.length, 3);
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
