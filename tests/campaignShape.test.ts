// tests/campaignShape.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { campaignInputShape, targetingSlot } from '../src/campaigns/shape.js';

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
