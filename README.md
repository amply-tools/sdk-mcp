# `@amplytools/amply-mcp` — retired

**This package no longer works.** Every published version is deprecated on npm, and this
repository is archived.

Amply's MCP server is now hosted by Amply, so there is nothing to install and no local process to
run. Point your agent at it:

```bash
claude mcp add --transport http amply https://api.amply.tools/mcp
```

Then run `/mcp` in your client and approve the access in the browser.

Everything else — what the hosted server can do, the tools it exposes, how authorization works,
and how to move an old setup across — is in the documentation, which is kept current:

### → [docs.amply.tools/reference/mcp-tools](https://docs.amply.tools/reference/mcp-tools)

This page is deliberately short and will not be updated again. Anything written here about the
hosted server would be wrong the first time it gained a tool, so it is not written here.

## One clean-up step

If you ever ran this package, delete `~/.amply/credentials.json`. It holds a live sign-in token for
your Amply account, and nothing uses it any more.

## What this was

A local MCP server that let an AI assistant work in an Amply account. It signed in with an email
and password and kept a token on disk. The hosted server replaces that with authorization in the
browser, which is why this was retired rather than updated.

The commit history and the [changelog](CHANGELOG.md) stay here as a record.

---

[Amply](https://amply.tools) · [Documentation](https://docs.amply.tools) · Apache-2.0
