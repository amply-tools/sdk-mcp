import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeFindApplicationTool } from '../src/tools/applications.js';

test('amply_find_application — tool metadata', () => {
  const t = makeFindApplicationTool();
  assert.equal(t.name, 'amply_find_application');
  assert.ok(t.description.length > 30);
});

test('amply_find_application — schema accepts required fields', () => {
  const t = makeFindApplicationTool();
  const p = t.inputSchema.safeParse({
    bundleId: 'com.example.app',
    platform: 'iOS',
  });
  assert.equal(p.success, true);
});

test('amply_find_application — schema accepts optional projectId', () => {
  const t = makeFindApplicationTool();
  const p = t.inputSchema.safeParse({
    bundleId: 'com.example.app',
    platform: 'Android',
    projectId: '00000000-0000-0000-0000-000000000000',
  });
  assert.equal(p.success, true);
});

test('amply_find_application — schema rejects empty bundleId', () => {
  const t = makeFindApplicationTool();
  const p = t.inputSchema.safeParse({ bundleId: '', platform: 'iOS' });
  assert.equal(p.success, false);
});

test('amply_find_application — schema rejects bad platform', () => {
  const t = makeFindApplicationTool();
  const p = t.inputSchema.safeParse({ bundleId: 'com.x', platform: 'BlackBerry' });
  assert.equal(p.success, false);
});
