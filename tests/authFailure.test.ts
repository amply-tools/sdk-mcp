// tests/authFailure.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isAuthFailure } from '../src/graphql/client.js';
import { AmplyError } from '../src/errors.js';

// Regression: an expired access token surfaces as HTTP 401 (no GraphQL body) and is
// classified `auth_expired`. That is the PRIMARY case the refresh token exists for, so
// it MUST trigger the silent refresh-and-retry — otherwise every expiry forces a
// password re-login despite a valid refresh token on disk.
test('auth_expired is a refreshable auth failure', () => {
  assert.equal(isAuthFailure(new AmplyError('auth_expired', 'Session expired (HTTP 401).')), true);
});

test('auth_required triggers refresh path', () => {
  assert.equal(isAuthFailure(new AmplyError('auth_required', 'No cached credentials.')), true);
});

test('jwt-shaped graphql_error triggers refresh path', () => {
  assert.equal(isAuthFailure(new AmplyError('graphql_error', 'invalid token: expired jwt')), true);
});

test('non-auth errors do not trigger refresh', () => {
  assert.equal(isAuthFailure(new AmplyError('not_found', 'x')), false);
  assert.equal(isAuthFailure(new AmplyError('graphql_error', 'something unrelated')), false);
  assert.equal(isAuthFailure(new Error('plain')), false);
});
