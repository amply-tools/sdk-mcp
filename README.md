# `@amplytools/amply-mcp`

Local MCP server for [Amply](https://amply.tools) — lets your AI agent sign up, log in, create projects, register applications, and fetch API keys without ever opening the Amply admin UI. Pairs with the [`amply-integration` skill](../amply-skill/) for a hands-free SDK integration.

## Why this exists

When an agent integrates the Amply SDK into a mobile app, the human still has to:

1. Sign up at `amply.tools`.
2. Create a project.
3. Register an application (bundleId + platform).
4. Copy `appId` / `apiKeyPublic` / `apiKeySecret` from the admin UI into `.env.local`.

This MCP eliminates steps 1–4. The agent calls `amply_ensure_app` and gets back the ready-to-paste env block.

## Install

### Claude Code

```bash
claude mcp add amply -- npx -y @amplytools/amply-mcp
```

After the first publish to npm. Until then, install from a local checkout:

```bash
git clone https://github.com/amply-tools/sdk-mcp.git
cd sdk-mcp && yarn install && yarn build
claude mcp add amply -- node "$(pwd)/dist/index.js"
```

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
