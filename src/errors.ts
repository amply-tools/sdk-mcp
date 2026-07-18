/**
 * Structured error codes the MCP returns inside tool responses.
 * Clients (AI agents) key off the `code` field to recover gracefully.
 */
export type AmplyErrorCode =
  | 'auth_required'        // No cached creds, or refresh failed.
  | 'auth_expired'         // Cached JWT expired (HTTP 401) — re-login needed.
  | 'unsupported_targeting' // Campaign uses a targeting type the API can't render.
  | 'invalid_credentials'  // login / signup rejected by backend.
  | 'not_found'            // Project / Application / ApiKey doesn't exist or no access.
  | 'validation_error'     // Backend rejected input.
  | 'limit_reached'        // A cap was hit (plan quota, or the 20-event-condition campaign cap).
  | 'conflict'             // e.g. bundleId already registered for this platform.
  | 'access_denied'        // Access control denied access (e.g. not the owner).
  | 'network_error'        // GraphQL endpoint unreachable / 5xx.
  | 'graphql_error'        // GraphQL returned errors[] we couldn't classify.
  | 'internal_error';      // Unexpected.

export class AmplyError extends Error {
  readonly code: AmplyErrorCode;
  readonly hint?: string;
  readonly cause?: unknown;

  constructor(code: AmplyErrorCode, message: string, opts: { hint?: string; cause?: unknown } = {}) {
    super(message);
    this.name = 'AmplyError';
    this.code = code;
    this.hint = opts.hint;
    this.cause = opts.cause;
  }

  toJSON(): { error: { code: AmplyErrorCode; message: string; hint?: string } } {
    return {
      error: {
        code: this.code,
        message: this.message,
        ...(this.hint ? { hint: this.hint } : {}),
      },
    };
  }
}

/**
 * Maps a GraphQL error / network failure into a structured AmplyError.
 * Keep this in one place so every tool produces the same shape.
 */
export function classifyGraphQLError(err: unknown): AmplyError {
  if (err instanceof AmplyError) return err;

  // graphql-request throws ClientError with .response.errors
  const anyErr = err as { response?: { errors?: Array<{ message?: string; extensions?: Record<string, unknown> }>; status?: number }; message?: string; code?: string; cause?: unknown };
  const gqlErrors = anyErr?.response?.errors;

  // graphql-request throws ClientError for non-2xx with the raw body in .response,
  // so an expired JWT (HTTP 401) has NO response.errors and would otherwise fall
  // through to internal_error. Catch it explicitly.
  const httpStatus = anyErr?.response?.status;
  const msg = anyErr?.message ?? '';
  const isExpiredJwtMsg = /expired jwt/i.test(msg);
  if (isExpiredJwtMsg || (httpStatus === 401 && !msg)) {
    return new AmplyError('auth_expired', 'Session expired (HTTP 401).', {
      hint: 'Run amply_login again — the cached session token expired.',
      cause: err,
    });
  }

  if (gqlErrors && gqlErrors.length > 0) {
    const first = gqlErrors[0];
    const msg = first?.message ?? 'GraphQL error';

    // Order matters — more specific patterns before more general ones.
    if (/access denied/i.test(msg)) {
      return new AmplyError('access_denied', msg);
    }
    if (/invalid email or password/i.test(msg)) {
      return new AmplyError('invalid_credentials', msg, {
        hint: 'Check the email/password — or run amply_signup to create a new account.',
      });
    }
    if (/jwt|expired|invalid token|unauthor/i.test(msg)) {
      return new AmplyError('graphql_error', msg);  // Client classifies this as auth and retries with refresh.
    }
    if (/organization\s+not\s+found/i.test(msg)) {
      // Backend uses this for "user has no current organization" — auth-shaped.
      return new AmplyError('access_denied', msg, {
        hint: 'The authenticated user has no current organization. Check your account.',
      });
    }
    if (/already.{0,5}(exist|registered)/i.test(msg)) {
      return new AmplyError('conflict', msg);
    }
    if (/(not\s+found|does\s+not\s+exist)/i.test(msg)) {
      return new AmplyError('not_found', msg);
    }
    // Cap-style failures only. Deliberately anchored: bare `quota` / `too many`
    // would misclassify validation messages ("Quota name must not be blank",
    // "Too many decimal places"). Recognized forms:
    //  - the event-condition campaign cap ("at most N event conditions"),
    //  - "<limit|quota> <reached|exceeded>" (e.g. "Active campaign limit reached"),
    //  - "over the limit".
    if (/(\bat\s+most\s+\d+\s+event\s+conditions\b|\b(limit|quota)\s+(reached|exceeded)\b|\bover\s+the\s+limit\b)/i.test(msg)) {
      return new AmplyError('limit_reached', msg, {
        hint: 'A limit was reached. Remove or consolidate existing resources/conditions, or upgrade your plan.',
      });
    }
    // Backend validation surfaces as multiple errors[]; keep them all in the message.
    if (gqlErrors.length > 1) {
      const all = gqlErrors.map((e) => e.message ?? '').join('; ');
      return new AmplyError('validation_error', all);
    }
    return new AmplyError('graphql_error', msg);
  }

  // Network-level failure. Node 20+ wraps fetch errors as
  // `TypeError: fetch failed` with `.cause.code` carrying ENOTFOUND etc.
  // graphql-request errors-out before throwing for non-2xx, but transport
  // failures bubble up here.
  const directCode = anyErr?.code;
  const causeCode = (anyErr?.cause as { code?: string } | undefined)?.code;
  const code = directCode ?? causeCode;
  if (code && /^(E(NOTFOUND|CONNREFUSED|TIMEDOUT|HOSTUNREACH|AI_AGAIN|NETUNREACH|FETCH_FAILED))$/.test(code)) {
    return new AmplyError('network_error', `Cannot reach Amply endpoint (${code})`, {
      hint: 'Check AMPLY_ENDPOINT or your network connection.',
      cause: err,
    });
  }
  // Node's fetch occasionally surfaces as TypeError: fetch failed without a code.
  if (anyErr?.message && /fetch failed/i.test(anyErr.message)) {
    return new AmplyError('network_error', anyErr.message, {
      hint: 'Endpoint unreachable. Check AMPLY_ENDPOINT and your network.',
      cause: err,
    });
  }

  return new AmplyError('internal_error', anyErr?.message ?? 'Unexpected error', { cause: err });
}
