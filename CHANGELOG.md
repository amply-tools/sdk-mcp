# Changelog

All notable changes to `@amplytools/amply-mcp` are documented here. Versioning follows [SemVer](https://semver.org/spec/v2.0.0.html).

## [0.5.0] — 2026-07-18

### Added
- Event-history conditions in campaign targeting. `amply_create_campaign` / `amply_update_campaign` accept two new targeting slots: `eventCount` (`{ event, compareType, value }` — how many times an event happened, including `equal 0` for "never") and `eventDate` (`{ event, bound: first|last, mode, relativeValue XOR absoluteValue }` — when it first/last happened). Both carry the full event reference (`name`, `type`, optional `params` filters). Client-side validation mirrors the backend: `isSet`/`isNotSet` are rejected for `eventCount`, relative modes require `relativeValue` (days ≥ 1), `beforeDate`/`afterDate` require `absoluteValue` (`YYYY-MM-DD`). `amply_describe_targeting` documents the new slots plus the rules: up to 20 event conditions per campaign; event conditions match only apps running Amply SDK 0.6.1 or later.
- New `limit_reached` error code. Cap-style rejections (plan quotas, the 20-event-condition campaign cap) previously classified as generic `validation_error`; agents can now tell "you hit a cap" apart from "fix your input".

### Fixed
- The `deeplink-on-session-n` template failed against the backend ("Event 'SessionStarted' requires repeatEntity to be 'event', got 'session'") — it could never create a campaign. It now uses `repeatEntity: 'event'`, semantically identical for a SessionStarted trigger (every Nth SessionStarted event is every Nth session).
- Tightened client-side validation to match the backend exactly: event-param `compareType` (`===`/`!==`/`>`/`>=`/`<`/`<=`) and `valueType` (`string`/`number`/`boolean`) are now strict enums on triggering params and event-condition params alike (both vocabularies exposed in `amply_describe_targeting`); `eventDate.absoluteValue` rejects calendar-impossible dates (e.g. `2026-02-30`); and `limit_reached` classification is anchored to explicit cap phrases so validation messages merely containing "quota" or "too many" no longer misclassify.
- `amply_get_campaign` failed with `unsupported_targeting` for any campaign carrying an event condition — and `amply_update_campaign` with it, since update reads first. The campaign query now selects the `EventCountTargetingPayload` / `EventDateTargetingPayload` fragments (with the Int `value` aliased as `eventCountValue` to keep the union merge legal) and the read-back mapper reconstructs both slots, restoring full round-trip.

## [0.4.0] — 2026-05-30

### Added
- `amply_create_campaign_from_template` gains a 6th template, `deeplink-on-property-change`. It fires a DeepLink campaign on the SDK's `CustomPropertyChanged` system event, filtering on the event payload's `key` + `newValue` (and optional `oldValue`) via Event Param filters. Params: `propertyKey`, `newValue`, optional `oldValue`, `deeplink`. Always created in Draft. Covers post-upgrade welcome / trial-expired recovery / plan-tier-change deeplinks without the app firing redundant `*_changed` custom events. Event-param `valueType` is pinned to `'string'` (values stringified) to match the documented `EventParamInput` contract rather than relying on backend type coercion.

## [0.3.2] — 2026-05-29

### Fixed
- Expired access token no longer forces a password re-login when a valid refresh token is on disk. A genuinely expired JWT comes back as HTTP 401 (no GraphQL body) and was classified `auth_expired`, but the silent-refresh trigger only recognized `auth_required` / jwt-text `graphql_error` — so the one case the refresh token exists for never triggered it. `auth_expired` now drives the same single refresh-and-retry. Added a regression test.

## [0.3.1] — 2026-05-29

### Fixed
- `amply_get_campaign` and `amply_update_campaign` failed for any campaign with a `customProperty` or `installDate` targeting rule (and `update` reads first, so it failed too). The campaign query selected `value` and `valueType` raw across the `targeting` union, where `value` is `String!` on the version payloads but `String` on `customProperty`, and `valueType` differs between `customProperty` and `installDate` — a GraphQL `FieldsInSetCanMerge` violation that rejected the whole query. The conflicting fields are now aliased (`customPropertyValue`, `customPropertyValueType`, `installDateValueType`), matching the admin dashboard's own selection. Added a regression test pinning the aliases.

## [0.3.0] — 2026-05-28

### Added
- `amply_create_campaign` — author a campaign from a full definition: trigger event with property-filter `params`, every-N `repeat` cadence, and full device/customProperty `targeting` (appVersion, osVersion, country, application, customProperty, installDate). Always created in `Draft`.
- `amply_update_campaign` — edit a campaign in place (top-level replace; current `state` preserved). Returns the full resulting config.
- `amply_describe_targeting` — discover the targeting + triggering vocabulary without external docs.

### Fixed
- `amply_get_campaign` and `amply_create_campaign_from_template` selected a non-existent `Campaign.project` field and an un-sub-selected `targeting` union → both failed. Corrected; `get` now returns full `triggering`/`targeting`/`content`.
- Expired session now returns `auth_expired` (was `internal_error`) with a re-login hint.

### Changed
- Idempotent read tools retry once on a transient network failure.

### Removed
- `amply_bootstrap_for_app` (deprecated since 0.2.0). Use `amply_ensure_app`.

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
