# Changelog

All notable changes to `@instawp/mcp-wp` are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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

[0.1.1]: https://github.com/InstaWP/mcp-wp/compare/v0.1.0...v0.1.1
[0.1.0]: https://github.com/InstaWP/mcp-wp/releases/tag/v0.1.0
