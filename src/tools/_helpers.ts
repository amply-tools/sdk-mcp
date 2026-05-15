import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { AmplyError } from '../errors.js';

/**
 * Re-export the SDK's CallToolResult for our tool handlers.
 * Shape: `content: Array<TextContent | ImageContent | ...>` plus optional `isError`.
 * We always emit `{ type: 'text', text: JSON.stringify(...) }` so agents get
 * a deterministic, parseable response body.
 */
export type { CallToolResult };

/**
 * Wrap a tool's payload (any JSON-serialisable value) into a CallToolResult.
 */
export function ok(payload: unknown): CallToolResult {
  return {
    content: [{ type: 'text', text: JSON.stringify(payload, null, 2) }],
  };
}

/**
 * Wrap a structured AmplyError (or any error) into an error-shaped CallToolResult.
 * The MCP `isError: true` flag signals the agent that the call failed; the JSON
 * body carries `{ error: { code, message, hint? } }` for programmatic recovery.
 */
export function fail(err: unknown): CallToolResult {
  const ampErr = err instanceof AmplyError ? err : new AmplyError('internal_error', String((err as Error)?.message ?? err));
  return {
    content: [{ type: 'text', text: JSON.stringify(ampErr.toJSON(), null, 2) }],
    isError: true,
  };
}

/**
 * Run a handler, mapping thrown errors to `fail()`. Tools never raise to the SDK —
 * we always return a CallToolResult so the agent gets a stable, machine-readable response.
 */
export async function safe(handler: () => Promise<CallToolResult>): Promise<CallToolResult> {
  try {
    return await handler();
  } catch (err) {
    return fail(err);
  }
}

/**
 * Stdio transport collides with stdout — any `console.log` would corrupt the
 * JSON-RPC stream. Use this for diagnostic logging instead; routes to stderr
 * and never echoes secret-looking strings (basic regex sweep).
 */
export function safeLog(...args: unknown[]): void {
  if (process.env.AMPLY_MCP_DEBUG !== '1') return;
  const SECRET_RE = /\b(eyJ[A-Za-z0-9_-]{10,}|[a-f0-9]{20,}|Bearer\s+\S+)\b/g;
  const safe = args
    .map((a) => (typeof a === 'string' ? a : JSON.stringify(a)))
    .map((s) => s.replace(SECRET_RE, '[REDACTED]'))
    .join(' ');
  process.stderr.write(`[amply-mcp] ${safe}\n`);
}
