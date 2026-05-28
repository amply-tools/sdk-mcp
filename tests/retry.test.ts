// tests/retry.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { retryOnceOnNetworkError } from '../src/graphql/client.js';
import { AmplyError } from '../src/errors.js';

test('retries once on network_error then succeeds', async () => {
  let calls = 0;
  const out = await retryOnceOnNetworkError(async () => {
    calls++;
    if (calls === 1) throw new AmplyError('network_error', 'fetch failed');
    return 'ok';
  });
  assert.equal(out, 'ok');
  assert.equal(calls, 2);
});

test('does not retry non-network errors', async () => {
  let calls = 0;
  await assert.rejects(async () => retryOnceOnNetworkError(async () => { calls++; throw new AmplyError('not_found', 'x'); }));
  assert.equal(calls, 1);
});
