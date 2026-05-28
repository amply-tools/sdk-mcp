// tests/targeting.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { targetingPayloadToInput } from '../src/campaigns/targeting.js';
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
  const out = targetingPayloadToInput([{ __typename: 'CustomPropertyTargetingPayload', key: 'plan', compareType: 'equal', valueType: 'string', value: 'pro', dateValueType: null, absoluteValue: null, relativeValue: null, dimension: null }]);
  assert.deepEqual(out, [{ customProperty: { key: 'plan', compareType: 'equal', valueType: 'string', value: 'pro' } }]);
});

test('installDate payload nests value', () => {
  const out = targetingPayloadToInput([{ __typename: 'InstallDateTargetingPayload', compareType: 'greater', valueType: 'relative', absoluteValue: null, relativeValue: 7, dimension: 'days' }]);
  assert.deepEqual(out, [{ installDate: { compareType: 'greater', value: { type: 'relative', relativeValue: 7, dimension: 'days' } } }]);
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
