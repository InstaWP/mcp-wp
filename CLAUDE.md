# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

This is a WordPress MCP (Model Context Protocol) server that allows interaction with WordPress sites through natural language via MCP-compatible clients like Claude Desktop. The server exposes WordPress REST API functionality as MCP tools.

## Development Commands

### Build and Run
```bash
# Install dependencies
npm install

# Build TypeScript to JavaScript
npm run build

# Run in development mode with hot reload
npm run dev

# Run the built server
npm start

# Clean build artifacts
npm run clean
```

### Environment Setup

#### Single Site Configuration
Create a `.env` file in the project root with:
```env
WORDPRESS_API_URL=https://your-wordpress-site.com
WORDPRESS_USERNAME=wp_username
WORDPRESS_PASSWORD=wp_app_password
```

#### Multi-Site Configuration
For managing multiple WordPress sites:
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
```

The app password can be generated from WordPress admin panel following the [Application Passwords guide](https://make.wordpress.org/core/2020/11/05/application-passwords-integration-guide#Getting-Credentials).

## Architecture

### Core Components

1. **MCP Server (`src/server.ts`)**: 
   - Entry point that initializes the MCP server using the ModelContextProtocol SDK
   - Registers all WordPress tools with their handlers
   - Uses StdioServerTransport for communication with Claude Desktop
   - Validates environment variables and establishes WordPress connection on startup

2. **Site Manager (`src/config/site-manager.ts`)**:
   - Manages multiple WordPress site configurations
   - Lazy loads site configurations from environment variables
   - Maintains separate authenticated Axios clients for each site
   - Provides site detection from context (domain mentions, aliases, site IDs)
   - Supports both numbered multi-site config and legacy single-site config

3. **WordPress Client (`src/wordpress.ts`)**:
   - Manages authenticated Axios instance for WordPress REST API calls
   - Integrates with SiteManager for multi-site support
   - Handles authentication using Basic Auth with application passwords
   - Provides `makeWordPressRequest()` wrapper for all API calls with optional `siteId` parameter
   - Logs to stderr via `logToFile()`, gated by `WORDPRESS_LOG_LEVEL` (default `error`); credential headers are redacted by `redactHeaders()`
   - Special handler `searchWordPressPluginRepository()` for WordPress.org plugin search

4. **Tool System (`src/tools/`)**: 
   - Each WordPress entity (posts, pages, media, etc.) has its own module
   - Each module exports tools array and handlers object
   - Tools use Zod schemas for input validation and type safety
   - All tools support optional `site_id` parameter for multi-site support
   - All tools are aggregated in `src/tools/index.ts`

### Tool Pattern

Each tool module follows this pattern:
```typescript
// Define Zod schemas for input validation
const listSchema = z.object({...});
const getSchema = z.object({...});
const createSchema = z.object({...});
const updateSchema = z.object({...});
const deleteSchema = z.object({...});

// Export tools array with MCP tool definitions
export const entityTools: Tool[] = [
  { name: "list_entity", description: "...", inputSchema: {...} },
  { name: "get_entity", description: "...", inputSchema: {...} },
  { name: "create_entity", description: "...", inputSchema: {...} },
  { name: "update_entity", description: "...", inputSchema: {...} },
  { name: "delete_entity", description: "...", inputSchema: {...} }
];

// Export handlers object with async functions
export const entityHandlers = {
  list_entity: async (params) => {...},
  get_entity: async (params) => {...},
  create_entity: async (params) => {...},
  update_entity: async (params) => {...},
  delete_entity: async (params) => {...}
};
```

### Unified Tool Architecture

The MCP server uses a **unified tool approach** to reduce complexity and tool count from ~65 to ~35 tools. Instead of separate tools for posts, pages, and custom post types, there are now unified tools that handle all content types.

#### **Unified Content Tools** (`unified-content.ts`) - 8 tools
Handles ALL content types (posts, pages, custom post types) with a single set of tools:
- `list_content` - List any content type with filtering and pagination
- `get_content` - Get specific content by ID and type
- `create_content` - Create new content of any type
- `update_content` - Update existing content of any type, including targeted partial edits
- `delete_content` - Delete content of any type
- `discover_content_types` - Find all available content types
- `find_content_by_url` - Smart URL resolver with optional full or targeted update
- `get_content_by_slug` - Search by slug across content types

#### **Unified Taxonomy Tools** (`unified-taxonomies.ts`) - 8 tools
Handles ALL taxonomies (categories, tags, custom taxonomies) with a single set of tools:
- `discover_taxonomies` - Find all available taxonomies
- `list_terms` - List terms in any taxonomy
- `get_term` - Get specific term by ID
- `create_term` - Create new term in any taxonomy
- `update_term` - Update existing term
- `delete_term` - Delete term from any taxonomy
- `assign_terms_to_content` - Assign terms to any content type
- `get_content_terms` - Get all terms for any content

#### **Site Management Tools** (`site-management.ts`) - 3 tools
- `list_sites` - List all configured WordPress sites
- `get_site` - Get details about a specific site
- `test_site` - Test connection to a WordPress site

#### **Other Specialized Tools**
- **Media** (`media.ts`): Media library management (5 canonical tools plus legacy `edit_media` alias)
- **Users** (`users.ts`): User management (~5 tools)
- **Comments** (`comments.ts`): Comment management (~5 tools)
- **Plugins** (`plugins.ts`): Plugin activation/deactivation (~5 tools)
- **Plugin Repository** (`plugin-repository.ts`): WordPress.org plugin search (~2 tools)
- **SQL Queries** (`sql-query.ts`): Execute read-only database queries (1 tool, requires custom endpoint)
  - **Note**: Uses `/mcp/v1/query` endpoint by default; customize via `WORDPRESS_SQL_ENDPOINT` environment variable

### Key Features

#### Smart URL Resolution
The `find_content_by_url` tool can:
- Take any WordPress URL and automatically find the corresponding content
- Detect the content type from URL patterns (e.g., `/documentation/` → documentation CPT)
- Optionally update the content in a single operation
- Cache content type information to minimize API calls

Example: Given `https://site.com/documentation/api-guide/`, it will:
1. Extract the slug `api-guide`
2. Detect hints suggesting a documentation content type
3. Search efficiently across relevant content types
4. Return or update the found content

#### Unified Content Management
All content operations use a single `content_type` parameter:
```json
{
  "content_type": "post",        // for blog posts
  "content_type": "page",        // for static pages
  "content_type": "product",     // for custom post types
  "content_type": "documentation" // for custom post types
}
```

Targeted content edits are also supported through `content_edit` on `update_content` and `find_content_by_url.update_fields`:

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

To retrieve an exact target string for those edits, `get_content` and `find_content_by_url` also support `include_raw_content: true`, which fetches the item with WordPress edit context and returns a top-level `content_raw` field.

Rendered WordPress HTML can differ from `content.raw`, so exact partial-edit targeting should use the raw value rather than copied rendered markup.

For targeted operations, `target_text` must match the stored raw WordPress content exactly. If it appears multiple times, provide `occurrence` to choose the 1-based match.

#### Unified Taxonomy Management
All taxonomy operations use a single `taxonomy` parameter:
```json
{
  "taxonomy": "category",        // for categories
  "taxonomy": "post_tag",        // for tags
  "taxonomy": "product_category", // for custom taxonomies
  "taxonomy": "skill"            // for custom taxonomies
}
```

The `taxonomy` parameter accepts either the taxonomy slug or its `rest_base`
(custom taxonomies can register a rest_base that differs from the slug, e.g.
slug `documentation_category` with rest_base `documentation-categories`).
All taxonomy tools resolve the identifier through a per-site cached
`/wp/v2/taxonomies` lookup and hard-error on unknown taxonomies — there is no
slug fallback. `assign_terms_to_content` derives success from the WordPress
response (the updated content's `rest_base` field must contain the requested
term IDs) rather than echoing the request.

#### Multi-Site Support
All tools accept an optional `site_id` parameter to target specific sites:
```json
{
  "content_type": "post",
  "site_id": "production"  // Optional - targets specific site
}
```

If `site_id` is not provided, the default site is used. Sites can be managed via:
- `list_sites` - See all configured sites
- `get_site` - Get details about a site
- `test_site` - Test connection to a site

## TypeScript Configuration

- Target: ES2022 with ESNext modules
- Strict mode enabled
- Source in `src/`, builds to `build/`
- Declaration files generated

## Claude Desktop Integration

The server integrates with Claude Desktop via the configuration in `claude_desktop_config.json`:
```json
{
  "mcpServers": {
    "wordpress": {
      "command": "npx",
      "args": ["-y", "@instawp/mcp-wp"],
      "env": {
        "WORDPRESS_API_URL": "https://your-site.com",
        "WORDPRESS_USERNAME": "username",
        "WORDPRESS_PASSWORD": "app_password"
      }
    }
  }
}
```

## Error Handling

- All API requests are wrapped in try-catch blocks
- Errors are logged to stderr with full request/response details (`WORDPRESS_LOG_LEVEL`, default `error`); credential headers such as `Authorization` and `Cookie` are redacted
- Process signals (SIGTERM, SIGINT) are handled gracefully
- Uncaught exceptions and rejections trigger proper shutdown

## Key Dependencies

- `@modelcontextprotocol/sdk`: MCP protocol implementation
- `axios`: HTTP client for WordPress REST API
- `zod`: Runtime type validation for tool inputs
- `dotenv`: Environment variable management
- `tsx`: TypeScript execution for development
