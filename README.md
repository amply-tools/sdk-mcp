> # ⚠️ Retired — this package no longer works
>
> Amply's MCP server is now **hosted by Amply's backend**. This npm package was a local
> stdio server that talked to the admin GraphQL API at `https://api.amply.tools/mcp/`.
> That path now serves the MCP protocol itself, so **every tool call from this package
> returns 404**. There is no environment variable that fixes it — the client appends
> `/mcp/` to whatever host you give it.
>
> Nothing to install any more. Point your agent at the hosted server:
>
> ```bash
> claude mcp add --transport http amply https://api.amply.tools/mcp
> ```
>
> Then run `/mcp` in Claude Code, approve the access in the browser, and you are connected.
> **[Full migration guide below.](#migrating-to-the-hosted-mcp)**
>
> If you have used this package before, delete `~/.amply/credentials.json` — it holds a
> live refresh token for your Amply account.

# `@amplytools/amply-mcp`

**Retired.** This was a local MCP server for [Amply](https://amply.tools), letting an AI agent provision an app and fetch its API keys without opening the admin UI. Amply's MCP is now hosted — see above.

## Migrating to the hosted MCP

### What changed

| | This package (retired) | Hosted MCP |
|---|---|---|
| **Install** | `claude mcp add amply -- npx -y @amplytools/amply-mcp` | `claude mcp add --transport http amply https://api.amply.tools/mcp` |
| **Runs** | a Node process on your machine (Node ≥ 20) | nothing locally |
| **Transport** | stdio | streamable HTTP |
| **Sign in** | `amply_login` with your email and password, in the chat | OAuth in the browser — you approve, the agent never sees a password |
| **Credentials** | JWT + refresh token in `~/.amply/credentials.json` | short-lived token held by your MCP client; nothing on disk |
| **Revoking access** | delete the credentials file | Amply admin → **Profile settings → Connected apps** |
| **Permissions** | all-or-nothing: whatever your account could do | seven separate permissions, listed on a consent screen you approve or decline |
| **Config** | `AMPLY_ENDPOINT`, `AMPLY_CREDS_FILE`, `AMPLY_MCP_DEBUG` | none |

### What you approve

The first time you connect, the browser shows a consent screen listing exactly what the
agent may do. It is one decision — allow or decline — and the list is what your client
asked for:

- view your projects and campaigns;
- create **draft** campaigns — drafts only, never launching a live one;
- view analytics for your apps and campaigns;
- start and stop campaigns, which decides whether real users see them;
- view your product prices and pending price changes;
- create, change and delete draft price changes and price indexes;
- send price changes to the App Store and Google Play — these really change prices for
  customers and cannot be undone.

Two things the consent screen will warn you about, both expected: the result comes back on
`localhost` (so only continue if you started the connection yourself), and your MCP client
registered itself rather than being pre-approved by Amply (which is how most MCP clients
work).

### The tools were renamed, and some are gone

Only `amply_ping` keeps the `amply_` prefix; everything else dropped it.

| This package | Hosted MCP |
|---|---|
| `amply_list_projects` | `projects_list` |
| `amply_list_campaigns` | `campaigns_list` |
| `amply_get_campaign` | `campaign_get` |
| `amply_create_campaign` | `campaign_create` (narrower — see below) |
| `amply_set_campaign_state` | `campaign_activate` / `campaign_stop` |
| `amply_describe_targeting` | the `amply://campaign/targeting-reference` resource |
| `amply_login` / `amply_logout` / `amply_status` / `amply_whoami` | replaced by the OAuth flow |
| `amply_signup`, `amply_create_project`, `amply_create_application`, `amply_create_api_key`, `amply_ensure_app`, `amply_find_application`, `amply_list_applications`, `amply_get_application` | **no equivalent yet** |
| `amply_update_campaign` | **no equivalent yet** |
| `amply_create_campaign_from_template` | **no equivalent** |
| — | new: `statistics_active_users`, `campaign_statistics`, and 16 `price_*` tools |

**The provisioning tools have no successor yet.** Creating a project, registering an
application and obtaining its API keys — what `amply_ensure_app` did in one call — is not
available over the hosted MCP today, so that step goes through the Amply admin UI. Work to
bring it back is planned.

### If you are porting a payload

The request shapes changed in ways that produce confusing errors rather than clear ones:

- keys are now `snake_case`: `project_id`, `app_version`, `repeat_type`, `compare_type`
  (they were `projectId`, `appVersion`, `repeatType`, `compareType`);
- comparison operators followed: `greater_or_equal`, `not_equal`, `is_set`
  (were `greaterOrEqual`, `notEqual`, `isSet`);
- `triggering.limit` is now **required** — pass `"limit": {}` if you have no limit;
- targeting on create accepts only `country`, `application`, `app_version` and
  `os_version`. Custom-property, install-date and event-history conditions are refused;
  author those in the admin UI for now.

---

*Everything below this line describes the retired package and is kept only so the migration
table above has something to refer to. None of it works against Amply today.*

## Why this exists

When an agent integrates the Amply SDK into a mobile app, the human still has to:

1. Sign up at `amply.tools`.
2. Create a project.
3. Register an application (bundleId + platform).
4. Copy `appId` / `apiKeyPublic` / `apiKeySecret` from the admin UI into `.env.local`.

This MCP eliminates steps 1–4. The agent calls `amply_ensure_app` and gets back the ready-to-paste env block.

## Install

**Do not.** This package no longer works — see the notice at the top of this file. The
install instructions that used to be here have been removed so they cannot be copied by
mistake.

### Codex CLI

```bash
codex mcp add amply -- npx -y @amplytools/amply-mcp
```

(Syntax depends on the Codex CLI version — verified on `codex-cli 0.128`. Run `codex mcp --help` first if unsure; older builds used `--command`/`--args` flags.)

### Other hosts

Any MCP host that supports stdio servers can launch the bundled `dist/index.js` directly. The binary speaks the standard MCP JSON-RPC protocol over stdin/stdout.

## Configuration

| Env var | Purpose | Default |
|---|---|---|
| `AMPLY_ENDPOINT` | Override the GraphQL endpoint. Pass either a full URL (`https://api.amply.tools/mcp/`) or just the host — `/mcp/` is auto-appended. | `https://api.amply.tools/mcp/` |
| `AMPLY_CREDS_FILE` | Override where the JWT + refresh token are persisted. Must be an absolute path. | `~/.amply/credentials.json` |
| `AMPLY_MCP_DEBUG` | Set to `1` to emit diagnostic stderr logs (with secret redaction). | unset |

Endpoint can also be passed as `--endpoint <url>` to the binary.

## Tools

| Tool | What it does |
|---|---|
| `amply_status` | Reports current endpoint + whether creds are cached. Never hits the network. |
| `amply_signup` | Create new account + organization. Caches the session. |
| `amply_login` | Log in to an existing account. Caches the session. |
| `amply_logout` | Clears the cached session. |
| `amply_whoami` | Returns the current user + organization (calls `me` query). |
| `amply_list_projects` | Lists projects (paginated). |
| `amply_create_project` | Creates a project. |
| `amply_list_applications` | Lists applications under a project (projectId required). |
| `amply_get_application` | Fetches one application by UUID, including its API keys. |
| `amply_create_application` | Registers a new app; returns the auto-generated first API key. |
| `amply_create_api_key` | Issues an additional API key for an existing application. |
| `amply_ensure_app` | Idempotent project + application + API-key resolution. Returns `created` / `reused` / `reused_new_key` / `conflict_cross_project`. |
| `amply_find_application` | Pure-read discovery; paginates every project in the organization when `projectId` is omitted. |
| `amply_list_campaigns` | Lists campaigns for an application. |
| `amply_get_campaign` | Fetches a single campaign by ID including triggering, targeting, and content. |
| `amply_set_campaign_state` | Activate, pause, or archive a campaign. |
| `amply_create_campaign_from_template` | Create a campaign from a curated template. Always Draft; activate explicitly. |
| `amply_create_campaign` | Create a campaign from a full definition (event property filters, every-N repeat, device/customProperty targeting, event conditions on past behavior — count + first/last occurrence date). Always Draft. |
| `amply_update_campaign` | Edit a campaign in place; top-level replace; current state is preserved. |
| `amply_describe_targeting` | Describe the targeting + triggering vocabulary (slots, comparators, predicate shapes, event-condition rules and caps). |

Every tool returns a JSON body inside the MCP `content[0].text` block. On failure, `isError: true` is set and the JSON contains `{ error: { code, message, hint? } }`.

### Error codes

| Code | Meaning |
|---|---|
| `auth_required` | No cached credentials (or refresh failed) — run `amply_login` / `amply_signup`. |
| `auth_expired` | Cached session token expired (HTTP 401); the server retries once with the refresh token, then asks for a re-login. |
| `invalid_credentials` | Login/signup rejected by the backend. |
| `not_found` | Project / application / API key / campaign doesn't exist, or no access. |
| `validation_error` | The backend rejected the input. |
| `limit_reached` | A cap was hit — a plan quota, or the per-campaign cap of 20 event conditions. |
| `unsupported_targeting` | The campaign uses a targeting type this MCP can't round-trip; edit it in the Amply dashboard. |
| `conflict` | E.g. bundleId already registered for the platform, or the campaign changed since you read it. |
| `access_denied` | Access control denied the operation (e.g. not the owner). |
| `network_error` | GraphQL endpoint unreachable / 5xx. |
| `graphql_error` | GraphQL returned errors that couldn't be classified. |
| `internal_error` | Unexpected failure. |

## Security model

- **JWT + refresh token are cached in plaintext** at `~/.amply/credentials.json` with mode `0600`. This is acceptable for a developer machine, but **do not** use on shared machines or commit the credentials file anywhere. Tokens are not returned through any tool's response.
- **The "secret" API key** (`apiKeySecret`) is a real secret in the sense that the backend hands it back once at creation time. It is, however, designed to be embedded in your mobile app's bundle — it's a per-application identifier, not a server-side admin key. Don't share it across apps, and don't commit it to a public repo.
- **stdio transport** means anything the MCP writes to stdout is part of the protocol. The server avoids stdout logging entirely; diagnostic output goes to stderr behind `AMPLY_MCP_DEBUG=1`, with a regex sweep that redacts hex-secret-shaped strings before writing.
- **`AMPLY_CREDS_FILE`** must be an absolute path. Relative paths, paths containing `..`, and paths under common code-repo directories are flagged at startup. Atomic write (`tmp` + `rename`) reduces (but does not eliminate) the chance of a partial-write on a refresh-token rotation; on a partial-write the user will be logged out and must re-login.

## Typical flow for an agent

```
amply_status                              → { authenticated: false, ... }
amply_signup({email, password, name, organization})
                                           → caches session
amply_ensure_app({bundleId: "com.acme.app", name: "Acme", platform: "iOS",
                  projectName: "Acme"})
                                           → { application, firstApiKey: { public, secret }, envBlock, status: "created" }
```

The agent pastes `envBlock` into `.env.local` and is done.

## Development

```bash
yarn install
yarn build       # tsup → dist/index.js (single ESM file with deps bundled)
yarn typecheck   # tsc --noEmit, strict
yarn dev         # tsup watch
yarn smoke       # JSON-RPC smoke test against a local stub
```

## License

Apache 2.0 — same as the Amply SDK.
