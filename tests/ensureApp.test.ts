import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeEnsureAppTool } from '../src/tools/ensure.js';

test('amply_ensure_app — tool metadata', () => {
  const t = makeEnsureAppTool();
  assert.equal(t.name, 'amply_ensure_app');
  assert.ok(t.description.includes('idempot') || t.description.includes('reuse'));
});

test('amply_ensure_app — schema rejects missing required field', () => {
  const t = makeEnsureAppTool();
  // name is required — omit it
  const p = t.inputSchema.safeParse({ bundleId: 'com.x.y', platform: 'iOS' });
  assert.equal(p.success, false);
});

test('amply_ensure_app — schema accepts minimal valid input', () => {
  const t = makeEnsureAppTool();
  const p = t.inputSchema.safeParse({
    bundleId: 'com.example.app',
    platform: 'iOS',
    name: 'Example',
  });
  assert.equal(p.success, true);
});

test('amply_ensure_app — schema accepts all optional flags', () => {
  const t = makeEnsureAppTool();
  const p = t.inputSchema.safeParse({
    bundleId: 'com.example.app',
    platform: 'Android',
    name: 'Example',
    projectName: 'Test Project',
    mintNewKey: true,
    allowDuplicateAcrossProjects: false,
  });
  assert.equal(p.success, true);
});

test('amply_ensure_app — schema rejects bad platform', () => {
  const t = makeEnsureAppTool();
  const p = t.inputSchema.safeParse({
    bundleId: 'com.example.app',
    platform: 'Windows',
    name: 'Example',
  });
  assert.equal(p.success, false);
});

test('amply_ensure_app — schema rejects empty bundleId', () => {
  const t = makeEnsureAppTool();
  const p = t.inputSchema.safeParse({ bundleId: '', platform: 'iOS', name: 'Example' });
  assert.equal(p.success, false);
});
