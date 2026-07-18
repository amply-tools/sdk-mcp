// tests/campaignTransform.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { shapeGetCampaign, buildCreateInput, mergeUpdateInput, validateWriteInput } from '../src/campaigns/transform.js';

const rawCampaign = {
  id: 'c1', name: 'Rewarded', type: 'DeepLink', state: 'Active',
  triggering: { event: { name: 'ButtonTapped', type: 'custom', params: [{ name: 'name', value: 'save', compareType: '===', valueType: 'string' }] }, repeat: { repeatType: 'every', repeatEntity: 'event', repeatValue: [2] }, limit: {} },
  content: { url: 'stillframe://ad?type=rewarded' },
  targeting: [{ __typename: 'AppVersionTargetingPayload', compareType: 'greater', value: '1.0.0' }],
  createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-02T00:00:00Z',
};

test('shapeGetCampaign normalizes targeting to input shape', () => {
  const c = shapeGetCampaign(rawCampaign);
  assert.deepEqual(c.targeting, [{ appVersion: { compareType: 'greater', value: '1.0.0' } }]);
  assert.equal(c.state, 'Active');
  // repeatValue is array (backend rejects scalars); triggering passes through unchanged.
  assert.deepEqual((c.triggering as { repeat: { repeatValue: number[] } }).repeat.repeatValue, [2]);
});

test('buildCreateInput always forces Draft and attaches project', () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const input = buildCreateInput('proj-1', 'Test', { type: 'DeepLink', triggering: rawCampaign.triggering as any, targeting: [{ appVersion: { compareType: 'greater', value: '1.0.0' } }], content: { url: 'x' } });
  assert.equal(input.name, 'Test');
  assert.equal(input.state, 'Draft');
  assert.equal(input.project, 'proj-1');
});

test('mergeUpdateInput preserves current state/type when patch omits them', () => {
  const current = shapeGetCampaign(rawCampaign);
  const merged = mergeUpdateInput(current, { triggering: { ...current.triggering, repeat: { repeatType: 'every', repeatEntity: 'event', repeatValue: [3] } } });
  assert.equal(merged.state, 'Active');     // NOT reset to Draft
  assert.equal(merged.type, 'DeepLink');
  assert.deepEqual((merged.triggering as { repeat: { repeatValue: number[] } }).repeat.repeatValue, [3]);
  assert.deepEqual(merged.targeting, current.targeting); // untouched targeting preserved
});

test('null-padded backend triggering survives the update read-first path', () => {
  // The live backend serializes the triggering JSON with explicit nulls for
  // unset nullable fields. Replaying that through validateWriteInput (the
  // amply_update_campaign path: read -> merge -> re-validate) must not fail —
  // .optional() Zod fields reject null, so the nulls have to be pruned on read.
  const raw = {
    ...rawCampaign,
    triggering: {
      event: { name: 'SessionStarted', type: 'system', params: [] },
      repeat: { repeatType: 'every', repeatEntity: 'event', repeatValue: [1], subRepeat: null },
      limit: { count: null, limit: null, limitType: null, interval: null, intervalDimension: null },
    },
  };
  const current = shapeGetCampaign(raw);
  const merged = mergeUpdateInput(current, { name: 'renamed' });
  assert.doesNotThrow(() => validateWriteInput(merged));
  const validated = validateWriteInput(merged);
  assert.deepEqual((validated.triggering as { limit: unknown }).limit, {});
  assert.equal('subRepeat' in (validated.triggering as { repeat: Record<string, unknown> }).repeat, false);
});

test('mergeUpdateInput replaces targeting wholesale when provided', () => {
  const current = shapeGetCampaign(rawCampaign);
  const merged = mergeUpdateInput(current, { targeting: [{ osVersion: { compareType: 'greater', value: '15' } }] });
  assert.deepEqual(merged.targeting, [{ osVersion: { compareType: 'greater', value: '15' } }]);
});
