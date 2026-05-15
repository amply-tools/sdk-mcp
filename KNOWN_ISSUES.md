# Known issues — v0.1.0

Tracked limitations to fold into v0.2.0 or later.

## 1. Refresh token rotation — lockout on partial write

**Severity:** low (rare, recoverable with re-login).

**Where:** `src/graphql/client.ts::tryRefresh()` and `src/auth/store.ts::writeCredentials()`.

The backend rotates the refresh token before returning the new pair. If the MCP
successfully receives the new pair but fails to persist it (disk full,
permission flip, signal mid-rename), the old refresh token is gone server-side
and the new pair is lost client-side. The user must re-login.

Atomic write (`writeFile(tmp)` + `rename(tmp, path)`) shortens the window but
cannot eliminate it.

**Pragmatic mitigation:** when `writeCredentials` throws after a successful
refresh, surface a distinct error code (`refresh_persist_failed`) so the agent /
user knows to expect the re-login prompt. **Not yet implemented in v0.1.0** —
the catch in `tryRefresh` currently treats all write failures as generic
refresh failures and clears creds. Add in v0.2.0.

## 2. Tool argument strictness

**Severity:** low.

**Where:** `src/index.ts::main()` passes `def.inputSchema.shape` to `server.tool(...)`.

The MCP SDK rebuilds an object schema from the shape, which drops any
`.strict()`, `.refine()`, transforms, and defaults applied on the outer Zod
object. As a result:

- Extra keys are silently stripped, not rejected.
- Defaults attached at the object level wouldn't fire (none in v0.1.0).
- Custom refinements at the object level wouldn't fire.

In v0.1.0 we have no object-level refinements / defaults, so this is currently
theoretical. Track for future tools.

**Mitigation if needed:** pre-validate args with the full Zod schema inside
each tool handler before doing real work.

## 3. Cross-host MCP install commands not validated

**Severity:** medium (publish blocker).

The README ships these commands:

- Claude Code: `claude mcp add amply -- npx -y @amplytools/amply-mcp`
- Codex CLI: `codex mcp add amply --command npx --args -y @amplytools/amply-mcp`

Neither has been run on a clean machine against the published package. Before
npm publish: verify both, plus at least one other host (Cursor / Windsurf), and
update the README with corrections.

## 4. No real end-to-end smoke against a running backend yet

**Severity:** medium (publish blocker).

`tools/list` works via JSON-RPC; `amply_status` works without auth. No tool has
actually exchanged messages with a running Amply backend in CI. Before public
release, run signup → bootstrap → verify API key shape against
`https://api.amply.tools` (or a local backend mirror), and add a recorded
fixture to the test suite.

## 5. Defaults to production endpoint without a tenant override

**Severity:** low.

Without `AMPLY_ENDPOINT`, the MCP points at `https://api.amply.tools/admin/graphql/`.
For most users this is correct; for self-hosted or test tenants on a different
host, they must override. Documented in README's Configuration table and in the
agent flow ("if the endpoint is wrong, set `AMPLY_ENDPOINT` and restart the
agent").
