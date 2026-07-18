// tests/graphqlSelections.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CAMPAIGN } from '../src/graphql/queries.js';
import { CAMPAIGN_CREATE, CAMPAIGN_EDIT } from '../src/graphql/mutations.js';

test('CAMPAIGN query no longer selects non-existent project field', () => {
  assert.doesNotMatch(CAMPAIGN, /campaign\([^)]*\)\s*{[\s\S]*project\s*{/);
});
test('CAMPAIGN query selects targeting union with __typename + fragments', () => {
  assert.match(CAMPAIGN, /targeting\s*{[\s\S]*__typename/);
  for (const t of ['AppVersionTargetingPayload','CustomPropertyTargetingPayload','ApplicationTargetingPayload','InstallDateTargetingPayload','OSVersionTargetingPayload','AppInstallVersionTargetingPayload','CountryTargetingPayload','EventCountTargetingPayload','EventDateTargetingPayload']) {
    assert.match(CAMPAIGN, new RegExp(`on ${t}`));
  }
});
test('CAMPAIGN event fragments select the nested event with params', () => {
  // Both event payload fragments must carry the same event sub-selection
  // (FieldsInSetCanMerge requires identical selections for the shared field).
  const eventSelections = CAMPAIGN.match(/event\s*{\s*name\s+type\s+params\s*{\s*name\s+value\s+compareType\s+valueType\s*}\s*}/g) ?? [];
  assert.equal(eventSelections.length, 2, 'expected identical event sub-selections on both event fragments');
});
test('CAMPAIGN aliases the EventCount Int value (eventCountValue)', () => {
  // `value` is Int! on EventCountTargetingPayload but String! on the version
  // payloads — selecting it raw fails FieldsInSetCanMerge (the 0.3.1 lesson).
  assert.match(CAMPAIGN, /eventCountValue:\s*value/);
  // And the eventDate fields merge clean unaliased.
  assert.match(CAMPAIGN, /on EventDateTargetingPayload\s*{[^}]*bound\s+mode\s+relativeValue\s+absoluteValue/);
});
test('CAMPAIGN query aliases the conflicting union fields (value / valueType)', () => {
  // `value` is String! on the version payloads but String on CustomProperty, and
  // `valueType` is CustomPropertyValueType vs DateValueType! — selecting them raw
  // fails GraphQL FieldsInSetCanMerge. Aliases (mirroring the admin frontend) keep
  // the response keys distinct. Regression guard for the get/update campaign break.
  assert.match(CAMPAIGN, /customPropertyValue:\s*value/);
  assert.match(CAMPAIGN, /customPropertyValueType:\s*valueType/);
  assert.match(CAMPAIGN, /installDateValueType:\s*valueType/);
});
test('CAMPAIGN_CREATE no longer selects project', () => {
  assert.doesNotMatch(CAMPAIGN_CREATE, /project\s*{/);
});
test('CAMPAIGN_EDIT exists and targets campaignEdit', () => {
  assert.match(CAMPAIGN_EDIT, /campaignEdit\(id:\s*\$id,\s*input:\s*\$input\)/);
});
