# WordPress MCP Server

This is a Model Context Protocol (MCP) server for WordPress, allowing you to interact with your WordPress site using natural language via an MCP-compatible client like Claude for Desktop. This server exposes various WordPress data and functionality as MCP tools.

## Usage

### Claude Desktop

1. Download and install [Claude Desktop](https://claude.ai/download).
2. Open Claude Desktop settings and navigate to the "Developer" tab.
3. Copy the contents of the `claude_desktop_config.json.example` file.
4. Click "Edit Config" to open the `claude_desktop_config.json` file.
5. Copy paste the contents of the example file into the config file. Make sure to replace the placeholder values with your actual values for the WordPress site. To generate the application keys, follow this guide - [Application Passwords](https://make.wordpress.org/core/2020/11/05/application-passwords-integration-guide#Getting-Credentials).
6. Save the configuration.
7. Restart Claude Desktop.

## Features

This server provides tools to interact with core WordPress data and supports **multi-site management** - manage multiple WordPress sites from a single MCP server instance.

### **Multi-Site Management** (3 tools)

Manage multiple WordPress sites from a single MCP server:

- `list_sites`: List all configured WordPress sites
- `get_site`: Get details about a specific site configuration
- `test_site`: Test connection to a specific WordPress site

All content and taxonomy tools support an optional `site_id` parameter to target specific sites.

### **Unified Content Management** (9 tools)

Handles ALL content types (posts, pages, custom post types) with a single set of intelligent tools:

- `list_content`: List any content type with filtering and pagination
- `get_content`: Get specific content by ID and type
- `create_content`: Create new content of any type
- `update_content`: Update existing content of any type, including targeted partial edits
- `delete_content`: Delete content of any type
- `discover_content_types`: Find all available content types on your site
- `find_content_by_url`: Smart URL resolver that can find and optionally update content from any WordPress URL, including targeted partial edits
- `get_content_by_slug`: Search by slug across all content types
- `get_content_summary`: Return a minimal summary (id, title, slug, status, excerpt, taxonomies, word count, Yoast SEO fields) for audit and lookup workflows. Look up by `id` or `url`.

### **Unified Taxonomy Management** (8 tools)

Handles ALL taxonomies (categories, tags, custom taxonomies) with a single set of tools:

- `discover_taxonomies`: Find all available taxonomies on your site
- `list_terms`: List terms in any taxonomy
- `get_term`: Get specific term by ID
- `create_term`: Create new term in any taxonomy
- `update_term`: Update existing term
- `delete_term`: Delete term from any taxonomy
- `assign_terms_to_content`: Assign terms to any content type
- `get_content_terms`: Get all terms for any content

### **Specialized Tools**

- **Media:**
  - `list_media`: List all media items (supports pagination and searching).
  - `get_media`: Retrieve a specific media item by ID.
  - `create_media`: Create a new media item from a URL or local file path.
  - `update_media`: Update an existing media item.
  - `delete_media`: Delete a media item.
  - `edit_media`: Legacy alias for `update_media` kept for backward compatibility.
- **Users:**
  - `list_users`: List all users with filtering, sorting, and pagination options.
  - `get_user`: Retrieve a specific user by ID.
  - `create_user`: Create a new user.
  - `update_user`: Update an existing user.
  - `delete_user`: Delete a user.
- **Comments:**
  - `list_comments`: List all comments with filtering, sorting, and pagination options.
  - `get_comment`: Retrieve a specific comment by ID.
  - `create_comment`: Create a new comment.
  - `update_comment`: Update an existing comment.
  - `delete_comment`: Delete a comment.
- **Plugins:**
  - `list_plugins`: List all plugins installed on the site.
  - `get_plugin`: Retrieve details about a specific plugin.
  - `activate_plugin`: Activate a plugin.
  - `deactivate_plugin`: Deactivate a plugin.
  - `create_plugin`: Create a new plugin.
- **Plugin Repository:**
- `search_plugins`: Search for plugins in the WordPress.org repository.
- `get_plugin_info`: Get detailed information about a plugin from the repository.
- **Database Queries:**
- `execute_sql_query`: Execute read-only SQL queries against the WordPress database (requires custom endpoint setup).

### **Key Advantages**

#### Media Upload Workflows

Upload a local screenshot from the same machine running the MCP server:

```json
{
  "file_path": "./screenshots/homepage.png",
  "title": "Homepage Screenshot",
  "alt_text": "Homepage screenshot showing the hero section"
}
```

Upload media from a remote URL:

```json
{
  "source_url": "https://example.com/assets/hero-image.png",
  "title": "Hero Image",
  "caption": "Imported from the design system"
}
```

Use the returned media ID as featured media on new content:

```json
{
  "content_type": "post",
  "title": "Release Notes",
  "content": "<p>Launch summary...</p>",
  "featured_media": 123
}
```

#### Smart URL Resolution

The `find_content_by_url` tool can:

- Take any WordPress URL and automatically find the corresponding content
- Detect content types from URL patterns (e.g., `/documentation/` → documentation custom post type)
- Optionally update the content in a single operation
- Works with posts, pages, and any custom post types

#### Audit & Lookup Summaries

The `get_content_summary` tool returns a minimal, fixed-shape representation of a single piece of content. Designed for audit and lookup workflows where the full WP REST response — which can exceed 50KB on recipe posts because of the rendered Recipe Maker card HTML — is overkill.

**Look up by ID** (with optional `content_type`, defaulting to `post`):

```json
{
  "id": 4274,
  "content_type": "post"
}
```

**Look up by URL** (content type is detected from the URL):

```json
{
  "url": "https://example.com/blog/easy-smoked-asparagus/"
}
```

`id` and `url` are mutually exclusive — provide exactly one.

The response shape is fixed:

```json
{
  "id": 4274,
  "title": "Easy Smoked Asparagus & Hot Honey",
  "slug": "easy-smoked-asparagus",
  "status": "publish",
  "link": "https://example.com/blog/easy-smoked-asparagus/",
  "excerpt": "Smoky asparagus with hot honey.",
  "date_modified": "2026-04-30T10:14:00",
  "categories": [12, 7],
  "tags": [33],
  "featured_media": 9012,
  "word_count": 875,
  "yoast_focus_keyword": "smoked asparagus",
  "yoast_meta_title": "Easy Smoked Asparagus | Example",
  "yoast_meta_description": "Smoky charred asparagus finished with chili-lime hot honey."
}
```

Field notes:

- `title` and `excerpt` are stripped to plain text (HTML tags removed, basic entities decoded).
- `word_count` prefers `yoast_head_json.schema.@graph[].wordCount` when Yoast SEO is active; otherwise it is computed from the rendered post content with HTML stripped.
- `yoast_meta_title` and `yoast_meta_description` are read from `yoast_head_json` on the post. They are `null` when Yoast SEO is not active.
- `yoast_focus_keyword` is read from `meta._yoast_wpseo_focuskw`. WordPress core only exposes meta keys that are registered with `show_in_rest`, and Yoast SEO does not register this key by default — so this field will typically be `null` unless a companion plugin registers it (see PR #17 for context on the broader meta-key REST exposure issue).
- This tool internally bypasses the response trimming added in PR #16 so it can read `yoast_head_json`. The trim still applies to all other tools.

#### Universal Content Operations

All content operations use a single `content_type` parameter:

```json
{
  "content_type": "post", // for blog posts
  "content_type": "page", // for static pages
  "content_type": "product", // for WooCommerce products
  "content_type": "documentation" // for custom post types
}
```

#### Targeted Content Edits

`update_content` and `find_content_by_url.update_fields` can patch the existing raw WordPress content without resending the full document.

To make exact matching easier, `get_content` and `find_content_by_url` both accept `include_raw_content: true`. When enabled, the response is fetched with WordPress edit context and includes a top-level `content_raw` field that matches what `content_edit.target_text` needs.

```json
{
  "content_type": "page",
  "id": 7,
  "include_raw_content": true
}
```

Append a short release note to the end of a post:

```json
{
  "content_type": "post",
  "id": 42,
  "content_edit": {
    "operation": "append",
    "value": "\n<p>Update: Early access is now open.</p>",
    "content_format": "html"
  }
}
```

Replace a unique HTML fragment or marker comment in place:

```json
{
  "content_type": "page",
  "id": 7,
  "content_edit": {
    "operation": "replace",
    "target_text": "<!-- pricing-card -->\n<p>Old price</p>\n<!-- /pricing-card -->",
    "value": "<!-- pricing-card -->\n<p>New price</p>\n<!-- /pricing-card -->",
    "content_format": "html"
  }
}
```

Notes:

- Rendered WordPress HTML can differ from `content.raw` because entities may be escaped and markup may be expanded, so use `include_raw_content` when you need an exact `target_text`.
- `target_text` matches the stored raw WordPress content exactly.
- If the same `target_text` appears multiple times, pass `occurrence` to choose the 1-based match.
- For posts stored as Gutenberg blocks, set `content_edit.convert_to_blocks` when inserting Markdown or HTML that should become blocks.

#### Universal Taxonomy Operations

All taxonomy operations use a single `taxonomy` parameter:

```json
{
  "taxonomy": "category", // for categories
  "taxonomy": "post_tag", // for tags
  "taxonomy": "product_category", // for WooCommerce
  "taxonomy": "skill" // for custom taxonomies
}
```

The `taxonomy` parameter accepts either the taxonomy slug or its `rest_base`
(they can differ for custom taxonomies, e.g. slug `documentation_category`
with rest_base `documentation-categories`). Tools resolve the identifier via
`/wp/v2/taxonomies` and error on unknown taxonomies instead of guessing.
`assign_terms_to_content` verifies the write against the WordPress response
and reports an error if the terms were not actually saved.

#### Recipe Cards (WP Recipe Maker)

Sites running [WP Recipe Maker](https://wordpress.org/plugins/wp-recipe-maker/) (WPRM) store recipe cards in a separate `wprm_recipe` custom post type referenced by shortcode from the surrounding blog post. The unified content tools handle these recipes directly — no recipe-specific tool family is needed.

**Reading recipes** — `get_content`, `list_content`, `find_content_by_url`, and `get_content_by_slug` all work with `content_type: "wprm_recipe"`. WPRM exposes the full structured recipe payload as a `recipe` field on the REST response, including ingredients, instructions, times, equipment, nutrition, notes, and rating.

**Writing recipes** — pass the recipe payload via `custom_fields.recipe` on `create_content` or `update_content`. WPRM hooks into the WordPress REST insert action (`rest_insert_wprm_recipe`) and reads `recipe` from the request body root, so any field documented by WPRM's data model is accepted.

> The `recipe` payload must be passed via `custom_fields` (which spreads at the request body root). The `meta` parameter nests its values under a `meta` key, which never reaches WPRM's REST hook.

Example update:

```json
{
  "content_type": "wprm_recipe",
  "id": 4274,
  "custom_fields": {
    "recipe": {
      "name": "Easy Smoked Asparagus",
      "summary": "Smoky asparagus with hot honey.",
      "servings": "4",
      "servings_unit": "people",
      "prep_time": "5",
      "cook_time": "60",
      "total_time": "65",
      "ingredients": [
        {
          "name": "",
          "ingredients": [
            { "uid": 0, "amount": "1", "unit": "Bunch", "name": "Asparagus Spears", "notes": "" },
            { "uid": 1, "amount": "1", "unit": "tbsp", "name": "Olive Oil", "notes": "" }
          ]
        }
      ],
      "instructions": [
        {
          "name": "",
          "instructions": [
            { "uid": 0, "name": "", "text": "Preheat smoker to 225°F.", "ingredients": [] },
            { "uid": 1, "name": "", "text": "Drizzle with oil, season, smoke 1 hour.", "ingredients": [] }
          ]
        }
      ],
      "notes": "Thicker spears need more time."
    }
  }
}
```

**Grouped ingredients and instructions** — recipes can split items into named groups like "For the sauce" / "For the chicken". Each entry in the outer `ingredients` (or `instructions`) array is one group with its own `name` and inner array:

```json
{
  "ingredients": [
    { "name": "For the sauce",   "ingredients": [ /* items */ ] },
    { "name": "For the chicken", "ingredients": [ /* items */ ] }
  ]
}
```

Commonly used recipe fields:

| Field           | Type            | Notes                                                |
| --------------- | --------------- | ---------------------------------------------------- |
| `name`          | string          | Recipe card title                                    |
| `summary`       | string          | Short blurb (HTML allowed)                           |
| `servings`      | string          | e.g. `"4"`                                           |
| `servings_unit` | string          | e.g. `"people"`, `"servings"`                        |
| `prep_time`     | string          | minutes, e.g. `"15"`                                 |
| `cook_time`     | string          | minutes                                              |
| `total_time`    | string          | minutes                                              |
| `ingredients`   | array of groups | nested structure shown above                         |
| `instructions`  | array of groups | nested structure shown above                         |
| `notes`         | string          | HTML allowed                                         |
| `equipment`     | array           | items shaped `{ id, name, notes, amount, uid }`      |
| `image_url`     | string          | upload-by-URL when no `image_id` is supplied         |

Course, cuisine, and keyword are stored as WPRM taxonomies (`wprm_course`, `wprm_cuisine`, `wprm_keyword`). Manage them with the unified taxonomy tools (`list_terms`, `create_term`, …) and link them to a recipe with `assign_terms_to_content`.

WPRM auto-syncs `recipe.summary` back to the WordPress `post_content` field on save. If you want the post body and the recipe summary to differ, pass `content` explicitly alongside `custom_fields.recipe`.

## Configuration

### Single Site Configuration

For managing a single WordPress site, use the following environment variables:

```env
WORDPRESS_API_URL=https://your-wordpress-site.com
WORDPRESS_USERNAME=wp_username
WORDPRESS_PASSWORD=wp_app_password
```

### Multi-Site Configuration

To manage multiple WordPress sites from a single MCP server, use numbered environment variables:

```env
# Site 1 (Production)
WORDPRESS_1_URL=https://production-site.com
WORDPRESS_1_USERNAME=admin
WORDPRESS_1_PASSWORD=app_password_1
WORDPRESS_1_ID=production
WORDPRESS_1_DEFAULT=true
WORDPRESS_1_ALIASES=prod,main

# Site 2 (Staging)
WORDPRESS_2_URL=https://staging-site.com
WORDPRESS_2_USERNAME=admin
WORDPRESS_2_PASSWORD=app_password_2
WORDPRESS_2_ID=staging
WORDPRESS_2_ALIASES=stage,dev

# Site 3 (Development)
WORDPRESS_3_URL=https://dev-site.com
WORDPRESS_3_USERNAME=admin
WORDPRESS_3_PASSWORD=app_password_3
WORDPRESS_3_ID=development
```

**Multi-Site Configuration Options:**

- `WORDPRESS_N_URL`: WordPress site URL (required)
- `WORDPRESS_N_USERNAME`: WordPress username (required)
- `WORDPRESS_N_PASSWORD`: WordPress application password (required)
- `WORDPRESS_N_ID`: Site identifier (optional, defaults to `siteN`)
- `WORDPRESS_N_DEFAULT`: Set to `true` to make this the default site (optional, first site is default)
- `WORDPRESS_N_ALIASES`: Comma-separated aliases for site detection (optional)

The server supports up to 10 sites. When using multi-site configuration, all tools accept an optional `site_id` parameter to target specific sites.

## Using with npx and .env file

You can run this MCP server directly using npx without installing it globally:

```bash
npx -y @instawp/mcp-wp
```

Make sure you have a `.env` file in your current directory with the following variables:

```env
WORDPRESS_API_URL=https://your-wordpress-site.com
WORDPRESS_USERNAME=wp_username
WORDPRESS_PASSWORD=wp_app_password

# Optional: Custom SQL query endpoint (default: /mcp/v1/query)
WORDPRESS_SQL_ENDPOINT=/mcp/v1/query

# Optional: Comma-separated list of top-level fields to strip from
# WordPress REST API responses before they are returned to the MCP
# client. Defaults to "yoast_head,yoast_head_json" — read-only schema
# markup that adds ~10KB to every response but is rarely useful to the
# LLM. Set to an empty string to disable trimming.
MCP_WP_STRIP_FIELDS=yoast_head,yoast_head_json
```

## Response Trimming

By default the server strips the top-level `yoast_head` and `yoast_head_json`
fields from every WordPress REST API response before returning it to the MCP
client. These fields contain Yoast SEO's pre-rendered schema markup, which the
LLM almost never needs but pays tokens for on every request.

- The trim applies to both single-object responses and arrays of objects.
- Only **top-level** fields are stripped; nested objects are left untouched.
- Override the list with the `MCP_WP_STRIP_FIELDS` environment variable
  (comma-separated). Set it to an empty string to disable trimming entirely.

## Meta field limitations

The `meta` parameter on `create_content`, `update_content`, and `find_content_by_url` (with `update_fields.meta`) forwards directly to the WordPress `/wp/v2/{type}/{id}` endpoint. WordPress core **silently drops** any meta key that has not been registered via `register_post_meta(..., ['show_in_rest' => true])`. The MCP server has no allowlist of its own — it relies on WordPress to enforce which keys persist.

This means SEO plugin keys are **not writable through this MCP server by default**, including:

- **Yoast SEO**: `_yoast_wpseo_*` (focuskw, metadesc, title, opengraph-*, twitter-*, canonical, meta-robots-*, primary_category, …)
- **Rank Math**: `rank_math_*` (title, description, focus_keyword, robots, facebook_*, twitter_*, primary_category, …)
- **All in One SEO (v4+)**: stores SEO data in a custom table (`wp_aioseo_posts`), not `wp_postmeta` — not addressable via the `meta` field by any means.

The server detects when WordPress dropped any keys you sent and prepends a `Warning:` block to the tool result listing them. This makes the silent drop visible to the LLM caller, but it cannot make WordPress accept the keys.

To enable SEO meta writes, install a small WordPress companion plugin that calls `register_post_meta` for each desired key with `show_in_rest => true` and an appropriate `auth_callback`. A separate `mcp-wp-seo-bridge` plugin is being scoped to do exactly this.

### Which keys DO work today

Plugin keys that the plugin author already registered for REST — for example Genesis layout meta (`_genesis_layout`), WP Recipe Maker fields (`wprm-*`), or ConvertKit's `_wp_convertkit_post_meta`. To check which keys round-trip on your site, write a test value via `update_content` and inspect the `meta` block in the response — if the key appears, it persisted.

The same limitation applies to term meta on `unified-taxonomies` tools (`create_term`, `update_term`).

## Enabling SQL Query Tool (Optional)

The `execute_sql_query` tool allows you to run read-only SQL queries against your WordPress database. This is an optional feature that requires adding a custom REST API endpoint to your WordPress site.

**Security Notes:**

- This tool only accepts read-only queries (SELECT, WITH...SELECT, EXPLAIN) for safety
- Queries containing INSERT, UPDATE, DELETE, DROP, or other modifying statements will be rejected
- Multi-statement queries are blocked to prevent SQL injection
- Queries and results are logged to `logs/wordpress-api.log` - avoid including sensitive data in queries
- This tool requires admin-level permissions (`manage_options` capability)

**Configuration:** By default, the tool expects the endpoint at `/mcp/v1/query`. You can customize this by setting the `WORDPRESS_SQL_ENDPOINT` environment variable (e.g., `WORDPRESS_SQL_ENDPOINT=/custom/v1/query`).

To enable this feature, add the following code to your WordPress site (via a custom plugin or your theme's `functions.php`):

```php
add_action('rest_api_init', function() {
    register_rest_route('mcp/v1', '/query', array(
        'methods' => 'POST',
        'callback' => function($request) {
            global $wpdb;

            $query = $request->get_param('query');

            // Additional security check
            if (!current_user_can('manage_options')) {
                return new WP_Error('unauthorized', 'Unauthorized', array('status' => 401));
            }

            // Only allow SELECT queries
            if (stripos(trim($query), 'SELECT') !== 0) {
                return new WP_Error('invalid_query', 'Only SELECT queries allowed', array('status' => 400));
            }

            $results = $wpdb->get_results($query, ARRAY_A);

            if ($wpdb->last_error) {
                return new WP_Error('query_error', $wpdb->last_error, array('status' => 400));
            }

            return array(
                'results' => $results,
                'num_rows' => count($results)
            );
        },
        'permission_callback' => function() {
            return current_user_can('manage_options');
        }
    ));
});
```

After adding this code, you can use the `execute_sql_query` tool to run queries like:

```sql
SELECT * FROM wp_posts WHERE post_type = 'post' AND post_status = 'publish' LIMIT 10
```

## Development

### Prerequisites

- **Node.js and npm:** Ensure you have Node.js (version 18 or higher) and npm installed.
- **WordPress Site:** You need an active WordPress site with the REST API enabled.
- **WordPress API Authentication:** Set up authentication for the WordPress REST API. This typically requires an authentication plugin or method (like Application Passwords).
- **MCP Client:** You need an application that can communicate with the MCP Server. Currently, Claude Desktop is recommended.

### Installation and Setup

1.  **Clone the Repository:**

    ```bash
    git clone <repository_url>
    cd wordpress-mcp-server
    ```

2.  **Install Dependencies:**

    ```bash
    npm install
    ```

3.  **Create a `.env` file:**

    Create a `.env` file in the root of your project directory and add your WordPress API credentials.

    For a single site:

    ```env
    WORDPRESS_API_URL=https://your-wordpress-site.com
    WORDPRESS_USERNAME=wp_username
    WORDPRESS_PASSWORD=wp_app_password
    ```

    For multiple sites:

    ```env
    WORDPRESS_1_URL=https://site1.com
    WORDPRESS_1_USERNAME=admin
    WORDPRESS_1_PASSWORD=app_password_1
    WORDPRESS_1_ID=site1
    WORDPRESS_1_DEFAULT=true

    WORDPRESS_2_URL=https://site2.com
    WORDPRESS_2_USERNAME=admin
    WORDPRESS_2_PASSWORD=app_password_2
    WORDPRESS_2_ID=site2
    ```

    Replace the placeholders with your actual values.

4.  **Build the Server:**

    ```bash
    npm run build
    ```

5.  **Configure Claude Desktop:**

    - Open Claude Desktop settings and navigate to the "Developer" tab.
    - Click "Edit Config" to open the `claude_desktop_config.json` file.
    - Add a new server configuration under the `mcpServers` section. You will need to provide the **absolute** path to the `build/server.js` file and your WordPress environment variables.
    - Save the configuration.

### Running the Server

Once you've configured Claude Desktop, the server should start automatically whenever Claude Desktop starts.

You can also run the server directly from the command line for testing:

```bash
npm start
```

or in development mode:

```bash
npm run dev
```

### Running Tests

The repo uses [Vitest](https://vitest.dev/) for unit tests. Tests live under `tests/` and cover the
multi-site `SiteManager` and the MCP tool registry wiring.

```bash
npm test          # one-shot run
npm run test:watch  # watch mode
```

Tests run on `pull_request` and on pushes to `main` via `.github/workflows/test.yml`.

### Releasing

Merging a fix does not reach anyone — npm keeps serving the last published version until a release
runs. Publishing is automated by `.github/workflows/release.yml`, triggered by a version tag:

```bash
# on main, with the fix already merged:
# 1. move the CHANGELOG's [Unreleased] block under a `[x.y.z] - <date>` heading and commit it
# 2. bump and tag — `npm version` writes package.json, commits, and creates the vx.y.z tag
npm version patch          # or minor / major
# 3. push the commit and the tag; the tag is what triggers the publish
git push origin main --follow-tags
```

Do the CHANGELOG edit *before* `npm version`. Amending the commit afterwards leaves the tag pointing
at the pre-amend commit, and the workflow would publish from that.

The workflow refuses to publish if the tag and `package.json` disagree, or if that version is
already on npm; it then builds, runs the tests, publishes with
[provenance](https://docs.npmjs.com/generating-provenance-statements), and confirms the registry
actually serves the new version before reporting success.

If a tag exists but the publish failed (or predates this workflow), re-run it from
**Actions → Release → Run workflow**, leaving the branch selector on `main` (that is where the
workflow file is read from) and passing the tag name in the input. Two caveats: the tag's tree must
already contain the `repository` field described below, and the provenance attestation records the
ref the workflow was *dispatched from*, not the tag — so for a real release, prefer re-cutting a
version and using the tag-push path.

If the publish succeeds but the verification step goes red (a registry that stayed slow for more
than two minutes), check npmjs.com before doing anything: the version is published, and re-running
will now fail the already-on-npm guard by design. Nothing needs fixing in that case.

**Setup, once:** the workflow needs an npm automation token with publish rights on the `@instawp`
scope, stored as the repository secret `NPM_TOKEN` (Settings → Secrets and variables → Actions). An
*automation* token specifically — a classic publish token fails in CI on a 2FA-enforced account.

npm's [trusted publishing](https://docs.npmjs.com/trusted-publishers) would remove the stored token
entirely, but it needs npm ≥ 11.5.1 and `setup-node` currently ships npm 10.x with Node 22, so it is
not usable here without also upgrading npm inside the job.

Publishing with provenance requires the `repository` field in `package.json` to match this repo — the
registry rejects the publish otherwise. Don't remove it.

### Security

- **Never commit your API keys or secrets to version control.**
- **Use HTTPS for communication between the client and server.**
- **Validate all inputs received from the client to prevent injection attacks.**
- **Implement proper error handling and rate limiting.**

## Project Overview

### Architecture

The server uses a **unified tool architecture** to reduce complexity:

```text
src/
├── server.ts                    # MCP server entry point
├── wordpress.ts                 # WordPress REST API client
├── cli.ts                      # CLI interface
├── config/
│   └── site-manager.ts         # Multi-site management
├── types/
│   └── wordpress-types.ts      # TypeScript definitions
└── tools/
    ├── index.ts                # Tool aggregation
    ├── site-management.ts      # Site management (3 tools)
    ├── unified-content.ts      # Universal content management (8 tools)
    ├── unified-taxonomies.ts   # Universal taxonomy management (8 tools)
    ├── media.ts               # Media management (5 canonical tools + edit_media alias)
    ├── users.ts               # User management (~5 tools)
    ├── comments.ts            # Comment management (~5 tools)
    ├── plugins.ts             # Plugin management (~5 tools)
    ├── plugin-repository.ts   # WordPress.org plugin search (~2 tools)
    └── sql-query.ts           # Database queries (1 tool)
```

### Key Features

- **Multi-Site Support**: Manage multiple WordPress sites from a single MCP server instance
- **Smart URL Resolution**: Automatically detect content types from URLs and find corresponding content
- **Universal Content Management**: Single set of tools handles posts, pages, and custom post types
- **Universal Taxonomy Management**: Single set of tools handles categories, tags, and custom taxonomies
- **Type Safety**: Full TypeScript support with Zod schema validation
- **Comprehensive Logging**: Detailed API request/response logging for debugging
- **Error Handling**: Graceful error handling with informative messages

### Getting Started

1. Clone the repository and install dependencies with `npm install`
2. Create a `.env` file with your WordPress credentials
3. Build the project with `npm run build`
4. Configure Claude Desktop with the server
5. Start using natural language to manage your WordPress site!

### Contribution

Feel free to open issues or make pull requests to improve this project. Check out `CLAUDE.md` for detailed development guidelines.
