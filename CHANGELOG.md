# Changelog

All notable changes to `@amplytools/amply-mcp` are documented here. Versioning follows [SemVer](https://semver.org/spec/v2.0.0.html).

## [0.1.0] — Unreleased

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

### Pending (blocks public release)

- Real end-to-end smoke against a running Amply backend.
- `claude mcp add` + `codex mcp add` one-liners verified on a clean machine.
- Phase D pressure scenarios with the `amply-integration` skill present.
- npm publish via `@amplytools` scope.
