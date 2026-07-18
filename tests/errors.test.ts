// tests/errors.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { classifyGraphQLError, AmplyError } from '../src/errors.js';

test('expired JWT (HTTP 401 ClientError, no errors[]) -> auth_expired', () => {
  const clientError = {
    message: 'GraphQL Error (Code: 401): {"response":{"status":401,"body":"{\\"code\\":401,\\"message\\":\\"Expired JWT Token\\"}"}}',
    response: { status: 401, errors: undefined },
  };
  const e = classifyGraphQLError(clientError);
  assert.equal(e.code, 'auth_expired');
  assert.match(e.hint ?? '', /amply_login/);
});

test('unsupported_targeting code is valid (type smoke)', () => {
  const e = new AmplyError('unsupported_targeting', 'x');
  assert.equal(e.code, 'unsupported_targeting');
});

function gqlError(message: string) {
  return { response: { errors: [{ message }], status: 200 } };
}

test('event-condition cap message classifies as limit_reached', () => {
  const e = classifyGraphQLError(gqlError('A campaign can have at most 20 event conditions'));
  assert.equal(e.code, 'limit_reached');
  assert.match(e.message, /at most 20 event conditions/);
  assert.ok(e.hint, 'limit_reached should carry a recovery hint');
});

test('plan limit / quota phrases classify as limit_reached', () => {
  for (const msg of ['Project limit reached', 'Quota exceeded for applications', 'Too many API keys']) {
    const e = classifyGraphQLError(gqlError(msg));
    assert.equal(e.code, 'limit_reached', `"${msg}" should be limit_reached`);
  }
});

test('ordinary validation message is NOT limit_reached', () => {
  const e = classifyGraphQLError(gqlError('This value should not be blank.'));
  assert.notEqual(e.code, 'limit_reached');
});
