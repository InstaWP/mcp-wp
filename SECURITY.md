# Security Policy

## Reporting a vulnerability

**Please do not open a public issue for a security problem.**

Two private channels, either is fine:

1. **GitHub private vulnerability reporting** — [open a private advisory](https://github.com/InstaWP/mcp-wp/security/advisories/new).
   This is preferred: it keeps the report, the discussion and the fix in one place, and lets us credit
   you on the published advisory.
2. **Email** — `support@instawp.com`, with `[security]` at the start of the subject line so it is
   routed rather than queued behind ordinary support.

Include whatever you have: the affected file or tool, a proof-of-concept payload, the version or
commit you tested against, and what an attacker gets out of it. A short reproduction is worth more
than a long description.

## What to expect

| | |
|---|---|
| First response | within 3 working days |
| Assessment and a fix plan | within 10 working days |
| Fix released | as soon as it is ready; critical issues are prioritised over everything else |

We will keep you updated while we work, tell you when the fix is published, and credit you in the
advisory and the changelog unless you would rather stay anonymous. We do not currently run a bug
bounty, so there is no payment — we say so up front rather than leaving you to ask.

## Scope

In scope: this repository — the `@instawp/mcp-wp` MCP server and its published npm package, including
the WordPress-side endpoint example in `README.md`.

Notable classes we care about:

- Anything that lets a tool reach outside what its description promises — most of all
  `execute_sql_query`, whose read-only guarantee is a security boundary. It is a guard against a
  model, including one under prompt injection, issuing a destructive or filesystem-reaching query
  with the operator's own credentials.
- Credentials (WordPress application passwords, cookies, tokens) leaking into logs, error messages,
  tool output, or anywhere else the model or the host client can read them.
- Anything that turns a hostile WordPress response into code execution or file writes on the machine
  running the server.

Out of scope: vulnerabilities in WordPress core, third-party plugins or themes (report those to
their maintainers or to the [WordPress security team](https://wordpress.org/about/security/)); the
InstaWP hosted platform (email `support@instawp.com`); and findings that depend on an attacker
already holding the site's administrator credentials, since every tool here acts with them by design.

## Supported versions

Fixes are released against the latest published version on npm. There are no long-term support
branches while the package is pre-1.0 — please upgrade before reporting.
