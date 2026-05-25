import { homedir } from 'node:os';
import { isAbsolute, join, normalize, sep } from 'node:path';

/**
 * Resolves the Amply GraphQL endpoint from env / CLI overrides.
 *
 * MCP client traffic targets the dedicated `/mcp` GraphQL route, which can be
 * rate-limited / scoped independently of the admin UI.
 *
 * Precedence (highest first):
 *   1. AMPLY_ENDPOINT env var
 *   2. --endpoint <url> CLI flag passed to the MCP server
 *   3. Default: https://api.amply.tools/mcp/
 */
export function resolveEndpoint(argv: readonly string[] = process.argv): string {
  const fromEnv = process.env.AMPLY_ENDPOINT;
  if (fromEnv && fromEnv.length > 0) return normaliseEndpoint(fromEnv);

  const idx = argv.findIndex((a) => a === '--endpoint');
  if (idx >= 0 && argv[idx + 1]) return normaliseEndpoint(argv[idx + 1] as string);

  return 'https://api.amply.tools/mcp/';
}

/**
 * Where we persist the JWT + refresh token between MCP invocations.
 *
 * Precedence:
 *   1. AMPLY_CREDS_FILE env var (used by CI / sandbox runs)
 *   2. Default: ~/.amply/credentials.json
 *
 * Security: validates the override path to mitigate accidental footguns:
 *   - must be absolute (no relative paths that depend on CWD)
 *   - must not contain `..` segments after normalisation
 *   - must not land inside a code-repository directory (`node_modules`, `.git`)
 *   On violation, throws synchronously at startup — the MCP refuses to boot.
 */
export function resolveCredsFile(): string {
  const fromEnv = process.env.AMPLY_CREDS_FILE;
  if (fromEnv && fromEnv.length > 0) {
    validateCredsPath(fromEnv);
    return fromEnv;
  }
  return join(homedir(), '.amply', 'credentials.json');
}

const FORBIDDEN_PARENT_SEGMENTS = new Set(['node_modules', '.git', '.svn', '.hg', 'dist', 'build']);

function validateCredsPath(raw: string): void {
  if (!isAbsolute(raw)) {
    throw new Error(`AMPLY_CREDS_FILE must be an absolute path (got: ${raw})`);
  }
  const normalised = normalize(raw);
  if (normalised.includes(`..${sep}`) || normalised.endsWith(`${sep}..`)) {
    throw new Error(`AMPLY_CREDS_FILE must not contain '..' segments (got: ${raw})`);
  }
  const segments = normalised.split(sep);
  // Reject if any parent segment is in the forbidden list. Final-segment matches are
  // typically not real folders (you wouldn't NAME the creds file 'node_modules') but
  // we err on the side of rejecting them too.
  for (const segment of segments) {
    if (FORBIDDEN_PARENT_SEGMENTS.has(segment)) {
      throw new Error(
        `AMPLY_CREDS_FILE path contains a forbidden segment '${segment}' — refusing to write credentials under code-repo directories (got: ${raw})`,
      );
    }
  }
}

function normaliseEndpoint(raw: string): string {
  let url = raw.trim();
  if (!url.endsWith('/')) url = `${url}/`;
  // A URL that already targets `/mcp` is used as-is; a bare base URL (e.g.
  // `https://api.amply.tools`) gets the `/mcp/` path appended. Inspect the
  // pathname, not the whole string, so a host like `mcp.example.com` isn't
  // mistaken for an already-complete path.
  let path: string;
  try {
    path = new URL(url).pathname;
  } catch {
    path = url;
  }
  if (path.includes('/mcp')) {
    return url;
  }
  return `${url.replace(/\/+$/, '')}/mcp/`;
}
