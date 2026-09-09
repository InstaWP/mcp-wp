# Changelog

All notable changes to `@instawp/mcp-wp` are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Security
- **`execute_sql_query`'s read-only gate no longer lets a SELECT reach the filesystem.** `INTO OUTFILE`,
  `INTO DUMPFILE` and `LOAD_FILE()` are valid SELECT syntax and matched none of the old checks (a
  `startsWith('SELECT')` prefix test, a multi-statement test, and a fixed DDL/DML blocklist), so
  `SELECT LOAD_FILE('/etc/passwd')` and `SELECT '<?php … ?>' INTO DUMPFILE '…/uploads/pwn.php'` both
  passed validation while the tool description promised "only SELECT queries are allowed". All three
  are now rejected. Every check also runs against a *normalized* query — string literals, quoted
  identifiers and comments collapsed to whitespace — so a keyword hidden inside a literal is no longer
  a false positive (`SELECT … WHERE title = 'how to drop a table'` used to be refused) and one split
  by a comment is not a bypass. A query that cannot be read unambiguously is rejected rather than
  guessed at: an unterminated string or comment; a backslash-escaped quote inside a literal (its
  meaning depends on the server's `NO_BACKSLASH_ESCAPES` sql_mode); a `/*!` MySQL **or `/*M!` MariaDB**
  executable comment, whose contents the server runs; or **a function called by a quoted name** —
  ``SELECT `LOAD_FILE`('/etc/passwd')`` and its `ANSI_QUOTES` double-quoted form resolve to the builtin
  on both engines (verified on MariaDB 11.8 and MySQL 8.0.46), so blanking the identifier the way an
  identifier is blanked would have erased the keyword before any check saw it. That test runs on the
  finished normalized query rather than on the raw text, so it holds however the name is separated from
  its `(` — including by a comment, and including a `--` comment started by a **control character**,
  which both servers accept (`my_isspace || my_iscntrl`) and no whitespace class covers. The `--`
  comment rule is therefore matched as `[\x00-\x20\x7f]`: too wide blanks text the server executes, and
  too narrow leaves text the server drops sitting between the tokens being compared. Above `0x7f` that
  rule is decided by `character_set_client`, and MySQL and MariaDB disagree with each other, so a high
  byte straight after `--` is **refused** rather than classified — guessing is a bypass either way.
  The example WordPress
  endpoint in `README.md` now repeats these checks server-side using the same scanner, since the
  client's validation is not a boundary — its previous regex-based normalizer stripped comments before
  string literals, which made `SELECT '#' INTO OUTFILE '/tmp/x'` read as harmless.
- **Credential-shaped request-body keys are redacted from debug logging too.** The `Data:` line one
  below the header bag logged the request body verbatim, and `create_user`/`update_user` pass their
  params straight through — so a `debug` run put a WordPress user's `password` in the clear in the same
  stderr stream. `password`, `token`, `secret`, `api_key` and their siblings now log as `[REDACTED]`,
  nested objects and arrays included. Query text and result rows are still not redacted; that is
  documented rather than changed.
- **Credential headers are redacted from debug logging.** `Authorization: Basic base64(user:app-password)`
  was logged verbatim at `debug` level, and base64 is reversible — so `WORDPRESS_LOG_LEVEL=debug` put
  the WordPress application password in the clear. Despite its name `logToFile` writes to stderr, which
  for a stdio MCP server the host client captures into its own log files. `Authorization`, `Cookie` and
  their siblings now log as `[REDACTED]`.

Both reported privately by Syed Anas Mohiuddin.

### Fixed
- **`execute_sql_query` no longer refuses an identifier that merely ends in a DDL keyword.** The
  blocklist matched `UPDATE\s+` rather than the whole word, so `SELECT last_update FROM …` came back as
  "potentially dangerous SQL statement". It now matches on word boundaries, which also catches a
  keyword at the very end of a query — something the trailing-whitespace form missed. `INSERT`,
  `TRUNCATE` and `REPLACE` are exempted when a `(` follows, because all three are also ordinary
  read-only functions (`SELECT INSERT('Quadratic',3,4,'What')`, `SELECT TRUNCATE(1.234,2)`,
  `SELECT REPLACE(a,'x','y')`); no statement form can reach that check anyway, since the query must
  already start with SELECT/WITH/EXPLAIN. `REPLACE` is new to the list — `REPLACE tbl SET …` needs no
  `INTO`, so nothing else there would have caught it.
- **The `README.md` endpoint accepts `WITH …` and `EXPLAIN …`**, which the client allows and the
  example rejected with a 400, and returns a 400 rather than a PHP error when `query` is not a string.
- **`README.md` no longer claims queries are logged to `logs/wordpress-api.log`.** No such file is
  written: logging goes to stderr, only when `WORDPRESS_LOG_LEVEL=debug` is set (the default is
  `error`). Same correction in `CLAUDE.md`.

### Added
- **`SECURITY.md`** — a private disclosure route (GitHub private vulnerability reporting, plus
  `support@instawp.com`), response targets, and scope. The reporter above had to find us through the
  support desk because the repository named no security contact.

## [0.2.0] - 2026-08-19

### Added
- **`WORDPRESS_USER_AGENT`.** Sets the user-agent on *every* outbound request — the WordPress REST
  client behind all tools, the SQL endpoint, both api.wordpress.org lookups, and remote media
  downloads. Unset (the default) keeps axios's own `axios/<version>`, so behaviour is unchanged
  unless you set it; an empty or whitespace-only value is treated as unset, since some edges block an
  empty user-agent too. For users behind a CDN/WAF that rejects the default. (#30)

### Changed
- **`execute_sql_query` explains an HTTP 403 instead of just reporting it.** A 403 may be WordPress
  rejecting the credentials *or* a CDN/WAF challenge page returned before the request reached
  WordPress; the error now says so, shows the response body (truncated) so the two can be told apart,
  and points at `WORDPRESS_USER_AGENT`. The bare `Request failed with status code 403` is what made
  #28 hard to diagnose. (#30)

### Security
- **Bumped `vitest` to `^4.1.11`** (dev dependency), clearing GHSA-5xrq-8626-4rwp — a critical
  advisory against `vitest < 3.2.6` (arbitrary file read/execute while the Vitest UI server is
  listening) — along with four moderate/high advisories in the bundled `vite` / `vite-node` /
  `esbuild` / `@vitest/mocker` chain. Dev-only: none of these ship in the published package.

## [0.1.2] - 2026-08-19

### Added
- **Automated npm publishing.** Pushing a `vX.Y.Z` tag now builds, tests and publishes the
  package with [provenance](https://docs.npmjs.com/generating-provenance-statements) via
  `.github/workflows/release.yml`, and verifies the registry actually serves the new version.
  Previously the package was published by hand, so a merged fix could sit unpublished
  indefinitely. See "Releasing" in the README. (#32)
- `repository`, `homepage` and `bugs` fields in `package.json` — the `repository` field is
  required for provenance and was missing. (#32)

### Note
- 0.1.1 was tagged and released on GitHub but never published to npm; this is the first
  published release containing the `execute_sql_query` User-Agent fix from #28.

## [0.1.1] - 2026-08-19

### Fixed
- **`execute_sql_query` no longer sends `User-Agent: Mozilla/5.0`.** The bare
  `Mozilla/5.0` is a well-known bot signature that CDNs/WAFs (WP Engine,
  Cloudflare bot protection) block with a 403 challenge page, so the tool failed
  against healthy, correctly authenticated SQL endpoints. It now sends no
  `User-Agent` override, matching every other tool in the package. (#28)

## [0.1.0] - 2026-06-15

### Added
- **Partial content edits.** `update_content` and `find_content_by_url` accept a
  `content_edit` object (`append`, `prepend`, `insert_before`, `insert_after`,
  `replace`) for targeted substring edits against the stored raw content instead
  of resending the whole document. Read tools gained `include_raw_content` (with a
  top-level `content_raw` alias) so callers can target the exact stored markup. (#26)
- **`get_content_summary` tool.** Returns a minimal, fixed-shape summary (id, title,
  slug, status, excerpt, taxonomy IDs, word count, Yoast SEO fields) by `id` or
  `url` — token-cheap for audit and lookup workflows. (#21)
- **Dropped-meta warnings.** `create_content`, `update_content`, and
  `find_content_by_url` now prepend a warning when WordPress silently drops meta
  keys that are not registered for REST (`show_in_rest`) — e.g. Yoast, Rank Math,
  or AIOSEO keys — so a no-op write is no longer reported as success. (#17)
- **Multi-site `site_id` for `execute_sql_query`.** Target a specific configured
  site in multi-site setups. (#25)
- **Test suite & CI.** Vitest setup with SiteManager and tool-registry coverage,
  plus a GitHub Actions workflow. (#18)

### Fixed
- **Taxonomy tools for divergent `rest_base`.** Taxonomies whose `rest_base`
  differs from their slug (e.g. `documentation_category` →
  `documentation-categories`) now resolve correctly via `/wp/v2/taxonomies`.
  `assign_terms_to_content` verifies the write against the WordPress response and
  reports an error instead of silently reporting success on a no-op write. (#23)
- **`execute_sql_query` endpoint URL.** Corrected from the wrong
  `…/wp-json/wp/v2/mcp/v1/query` to `…/wp-json/mcp/v1/query`, with hardened
  read-only validation. (#25)

### Changed
- **Response trimming.** `yoast_head` and `yoast_head_json` are stripped from REST
  responses by default (~10KB/response of rarely-used schema markup), configurable
  via the `MCP_WP_STRIP_FIELDS` environment variable. (#16)
- **BREAKING:** `assign_terms_to_content` `terms` now accepts only integer term IDs
  (`number[]`). Passing term slugs as strings is rejected at validation — WordPress
  only accepts term IDs on these REST fields, so string slugs were silently dropped
  before. (#23)

### Docs
- Documented meta-field limitations for SEO plugin keys. (#19)
- Documented WP Recipe Maker (WPRM) recipe-card support via `custom_fields`. (#20)

[0.2.0]: https://github.com/InstaWP/mcp-wp/compare/v0.1.2...v0.2.0
[0.1.2]: https://github.com/InstaWP/mcp-wp/compare/v0.1.1...v0.1.2
[0.1.1]: https://github.com/InstaWP/mcp-wp/compare/v0.1.0...v0.1.1
[0.1.0]: https://github.com/InstaWP/mcp-wp/releases/tag/v0.1.0
