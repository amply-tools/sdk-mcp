# Changelog

All notable changes to `@amplytools/amply-mcp` are documented here. Versioning follows [SemVer](https://semver.org/spec/v2.0.0.html).

## [0.2.2] — 2026-05-25

### Changed

- Default GraphQL endpoint is now `https://api.amply.tools/mcp/` — a dedicated route for MCP client traffic that can be rate-limited / scoped independently of the admin UI. `AMPLY_ENDPOINT` still overrides it; a bare host gets `/mcp/` appended.

## [0.2.1] — 2026-05-25

### Fixed

- Server `serverInfo.version` advertised on MCP `initialize` was hard-coded and lagged the package version (0.2.0 reported `0.1.0`). The version is now inlined from `package.json` at build time, so it can no longer drift.

## [0.2.0] — 2026-05-25

Adds idempotent app resolution, campaign tooling, and corrected install docs. Tool count 12 → 18.

### Added

- `amply_ensure_app` — idempotent project + application + API-key resolution and the recommended primary entry point for integration flows. Returns a status of `created` / `reused` / `reused_new_key` / `conflict_cross_project`; defaults to `mintNewKey: false` so re-running never silently mints duplicate keys.
- `amply_find_application` — pure-read discovery for preflight; when `projectId` is omitted it paginates every project in the organization.
- Campaign read tools: `amply_list_campaigns`, `amply_get_campaign`, `amply_set_campaign_state`.
- `amply_create_campaign_from_template` — creates a campaign from a five-template whitelist (`rate-review-after-positive-moment`, `deeplink-on-feature-discovery`, `deeplink-on-session-n`, `deeplink-on-custom-property`, `deeplink-after-positive-event-with-suppression`). Always created in `Draft`; activation is explicit via `amply_set_campaign_state`.

### Changed

- README install commands corrected: the Codex CLI one-liner now uses the `codex mcp add amply -- npx -y …` form (verified on `codex-cli 0.128`; the older `--command` / `--args` flags no longer apply), and the local-checkout clone URL points at `amply-tools/sdk-mcp`.

### Deprecated

- `amply_bootstrap_for_app` is now a thin wrapper around `amply_ensure_app({ mintNewKey: true })`, kept for one release to preserve existing behavior. Slated for removal in v0.3.0.

### Fixed

- The `deeplink-on-session-n` template emitted its trigger as `SessionStart`; the SDK fires that system event as `SessionStarted`, so the template would never match. Corrected.

## [0.1.0] — 2026-05-15

Initial implementation. Local stdio MCP server with 12 tools covering signup, login, project / application / API key CRUD, plus a one-shot `amply_bootstrap_for_app` for AI-agent integration flows.

### Added

- 12 tools: `amply_status`, `amply_signup`, `amply_login`, `amply_logout`, `amply_whoami`, `amply_list_projects`, `amply_create_project`, `amply_list_applications`, `amply_get_application`, `amply_create_application`, `amply_create_api_key`, `amply_bootstrap_for_app`.
- TypeScript / ESM, single-file build via tsup (~1 MB bundled).
- Reactive JWT refresh: on auth failure, swaps refresh token once, retries, clears creds on second failure.
- Local credentials cache at `~/.amply/credentials.json`, mode 0600, atomic writes.
- Structured error codes (`auth_required`, `not_found`, `conflict`, `access_denied`, etc.).
- Secret redaction in stderr diagnostic logs.

### Fixed (codex code review #1, same session)

- Narrowed the `application(id)` query selection to omit `apiKeys.secret`. Secrets are returned by the creation mutations (`apiKeyCreate` / `applicationCreate`); the list/get path is for inventory.
- Error classifier now handles: `"Organization not found"` → `access_denied`; `"Project limit reached"` / `quota` → `validation_error`; Node `fetch failed` with `cause.code` → `network_error`.
- Conflict regex tightened to match `already exist` / `already exists` / `already registered`.
- `AMPLY_CREDS_FILE` validation: rejects relative paths, paths with `..` segments, and paths under common code-repo dirs (`node_modules`, `.git`, etc.).
