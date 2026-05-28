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
