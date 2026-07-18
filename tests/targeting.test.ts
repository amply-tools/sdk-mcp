// tests/targeting.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { targetingPayloadToInput } from '../src/campaigns/targeting.js';
import { targetingSlot } from '../src/campaigns/shape.js';
import { AmplyError } from '../src/errors.js';

test('appVersion payload -> appVersion slot', () => {
  const out = targetingPayloadToInput([{ __typename: 'AppVersionTargetingPayload', compareType: 'greater', value: '1.0.0' }]);
  assert.deepEqual(out, [{ appVersion: { compareType: 'greater', value: '1.0.0' } }]);
});

test('application payload extracts ids into values', () => {
  const out = targetingPayloadToInput([{ __typename: 'ApplicationTargetingPayload', type: 'include', applications: [{ id: 'a1' }, { id: 'a2' }] }]);
  assert.deepEqual(out, [{ application: { type: 'include', values: ['a1', 'a2'] } }]);
});

test('customProperty with relative date nests dateValue and drops nulls', () => {
  // The GraphQL layer aliases the conflicting union fields, so the raw payload
  // arrives with `customPropertyValueType` / `customPropertyValue` (see queries.ts).
  const out = targetingPayloadToInput([{ __typename: 'CustomPropertyTargetingPayload', key: 'plan', compareType: 'equal', customPropertyValueType: 'string', customPropertyValue: 'pro', dateValueType: null, absoluteValue: null, relativeValue: null, dimension: null }]);
  assert.deepEqual(out, [{ customProperty: { key: 'plan', compareType: 'equal', valueType: 'string', value: 'pro' } }]);
});

test('installDate payload nests value', () => {
  const out = targetingPayloadToInput([{ __typename: 'InstallDateTargetingPayload', compareType: 'greater', installDateValueType: 'relative', absoluteValue: null, relativeValue: 7, dimension: 'days' }]);
  assert.deepEqual(out, [{ installDate: { compareType: 'greater', value: { type: 'relative', relativeValue: 7, dimension: 'days' } } }]);
});

test('eventCount payload (aliased eventCountValue) -> eventCount slot with params', () => {
  // The GraphQL layer aliases `value` (Int, clashes with String! on the version
  // payloads) as `eventCountValue` — the mapper must read the alias.
  const out = targetingPayloadToInput([{
    __typename: 'EventCountTargetingPayload',
    event: { name: 'PurchaseCompleted', type: 'custom', params: [{ name: 'product', value: 'pro', compareType: '===', valueType: 'string' }] },
    compareType: 'greaterOrEqual',
    eventCountValue: 2,
  }]);
  assert.deepEqual(out, [{
    eventCount: {
      event: { name: 'PurchaseCompleted', type: 'custom', params: [{ name: 'product', value: 'pro', compareType: '===', valueType: 'string' }] },
      compareType: 'greaterOrEqual',
      value: 2,
    },
  }]);
});

test('eventCount payload with value 0 (never happened) survives the mapping', () => {
  const out = targetingPayloadToInput([{
    __typename: 'EventCountTargetingPayload',
    event: { name: 'PaywallShown', type: 'custom', params: [] },
    compareType: 'equal',
    eventCountValue: 0,
  }]);
  assert.deepEqual(out, [{
    eventCount: { event: { name: 'PaywallShown', type: 'custom', params: [] }, compareType: 'equal', value: 0 },
  }]);
});

test('eventDate relative payload -> eventDate slot, null absoluteValue dropped', () => {
  const out = targetingPayloadToInput([{
    __typename: 'EventDateTargetingPayload',
    event: { name: 'PurchaseCompleted', type: 'custom', params: [] },
    bound: 'last',
    mode: 'moreThanDaysAgoOrNever',
    relativeValue: 30,
    absoluteValue: null,
  }]);
  assert.deepEqual(out, [{
    eventDate: { event: { name: 'PurchaseCompleted', type: 'custom', params: [] }, bound: 'last', mode: 'moreThanDaysAgoOrNever', relativeValue: 30 },
  }]);
});

test('eventDate absolute payload -> eventDate slot, null relativeValue dropped', () => {
  const out = targetingPayloadToInput([{
    __typename: 'EventDateTargetingPayload',
    event: { name: 'Onboarded', type: 'custom', params: [] },
    bound: 'first',
    mode: 'beforeDate',
    relativeValue: null,
    absoluteValue: '2026-07-01',
  }]);
  assert.deepEqual(out, [{
    eventDate: { event: { name: 'Onboarded', type: 'custom', params: [] }, bound: 'first', mode: 'beforeDate', absoluteValue: '2026-07-01' },
  }]);
});

test('reconstructed event slots round-trip through the input schema (update read-first path)', () => {
  const out = targetingPayloadToInput([
    {
      __typename: 'EventCountTargetingPayload',
      event: { name: 'PurchaseCompleted', type: 'custom', params: [{ name: 'product', value: 'pro', compareType: '===', valueType: 'string' }] },
      compareType: 'greaterOrEqual',
      eventCountValue: 2,
    },
    {
      __typename: 'EventDateTargetingPayload',
      event: { name: 'PurchaseCompleted', type: 'custom', params: [] },
      bound: 'last',
      mode: 'withinLastDays',
      relativeValue: 14,
      absoluteValue: null,
    },
  ]);
  for (const slot of out) {
    assert.doesNotThrow(() => targetingSlot.parse(slot));
  }
});

test('unknown payload type throws unsupported_targeting', () => {
  assert.throws(
    () => targetingPayloadToInput([{ __typename: 'SdkVersionTargetingPayload' }]),
    (e: unknown) => e instanceof AmplyError && e.code === 'unsupported_targeting',
  );
});

test('null/empty -> []', () => {
  assert.deepEqual(targetingPayloadToInput(null), []);
});
