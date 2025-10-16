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

*   `list_sites`: List all configured WordPress sites
*   `get_site`: Get details about a specific site configuration
*   `test_site`: Test connection to a specific WordPress site

All content and taxonomy tools support an optional `site_id` parameter to target specific sites.

### **Unified Content Management** (8 tools)
Handles ALL content types (posts, pages, custom post types) with a single set of intelligent tools:

*   `list_content`: List any content type with filtering and pagination
*   `get_content`: Get specific content by ID and type
*   `create_content`: Create new content of any type
*   `update_content`: Update existing content of any type
*   `delete_content`: Delete content of any type
*   `discover_content_types`: Find all available content types on your site
*   `find_content_by_url`: Smart URL resolver that can find and optionally update content from any WordPress URL
*   `get_content_by_slug`: Search by slug across all content types

### **Unified Taxonomy Management** (8 tools)
Handles ALL taxonomies (categories, tags, custom taxonomies) with a single set of tools:

*   `discover_taxonomies`: Find all available taxonomies on your site
*   `list_terms`: List terms in any taxonomy
*   `get_term`: Get specific term by ID
*   `create_term`: Create new term in any taxonomy
*   `update_term`: Update existing term
*   `delete_term`: Delete term from any taxonomy
*   `assign_terms_to_content`: Assign terms to any content type
*   `get_content_terms`: Get all terms for any content

### **Specialized Tools**

*   **Media:**
    *   `list_media`: List all media items (supports pagination and searching).
    *   `get_media`: Retrieve a specific media item by ID.
    *   `create_media`: Create a new media item from a URL.
    *   `update_media`: Update an existing media item.
    *   `delete_media`: Delete a media item.
*   **Users:**
    *   `list_users`: List all users with filtering, sorting, and pagination options.
    *   `get_user`: Retrieve a specific user by ID.
    *   `create_user`: Create a new user.
    *   `update_user`: Update an existing user.
    *   `delete_user`: Delete a user.
*   **Comments:**
    *   `list_comments`: List all comments with filtering, sorting, and pagination options.
    *   `get_comment`: Retrieve a specific comment by ID.
    *   `create_comment`: Create a new comment.
    *   `update_comment`: Update an existing comment.
    *   `delete_comment`: Delete a comment.
*   **Plugins:**
    *   `list_plugins`: List all plugins installed on the site.
    *   `get_plugin`: Retrieve details about a specific plugin.
    *   `activate_plugin`: Activate a plugin.
    *   `deactivate_plugin`: Deactivate a plugin.
    *   `create_plugin`: Create a new plugin.
*   **Plugin Repository:**
    *   `search_plugins`: Search for plugins in the WordPress.org repository.
    *   `get_plugin_info`: Get detailed information about a plugin from the repository.

### **Key Advantages**

#### Smart URL Resolution
The `find_content_by_url` tool can:
- Take any WordPress URL and automatically find the corresponding content
- Detect content types from URL patterns (e.g., `/documentation/` → documentation custom post type)
- Optionally update the content in a single operation
- Works with posts, pages, and any custom post types

#### Universal Content Operations
All content operations use a single `content_type` parameter:
```json
{
  "content_type": "post",        // for blog posts
  "content_type": "page",        // for static pages  
  "content_type": "product",     // for WooCommerce products
  "content_type": "documentation" // for custom post types
}
```

#### Universal Taxonomy Operations
All taxonomy operations use a single `taxonomy` parameter:
```json
{
  "taxonomy": "category",        // for categories
  "taxonomy": "post_tag",        // for tags
  "taxonomy": "product_category", // for WooCommerce
  "taxonomy": "skill"            // for custom taxonomies
}
```

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

Make sure you have a `.env` file in your current directory with the configuration variables shown above.

## Development

### Prerequisites

*   **Node.js and npm:** Ensure you have Node.js (version 18 or higher) and npm installed.
*   **WordPress Site:** You need an active WordPress site with the REST API enabled.
*   **WordPress API Authentication:** Set up authentication for the WordPress REST API. This typically requires an authentication plugin or method (like Application Passwords).
*   **MCP Client:** You need an application that can communicate with the MCP Server. Currently, Claude Desktop is recommended.

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

5. **Configure Claude Desktop:**

   * Open Claude Desktop settings and navigate to the "Developer" tab.
   * Click "Edit Config" to open the `claude_desktop_config.json` file.
   * Add a new server configuration under the `mcpServers` section. You will need to provide the **absolute** path to the `build/server.js` file and your WordPress environment variables.
   * Save the configuration.

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

### Security

*   **Never commit your API keys or secrets to version control.**
*   **Use HTTPS for communication between the client and server.**
*   **Validate all inputs received from the client to prevent injection attacks.**
*   **Implement proper error handling and rate limiting.**

## Project Overview

### Architecture

The server uses a **unified tool architecture** to reduce complexity:

```
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
    ├── media.ts               # Media management (~5 tools)
    ├── users.ts               # User management (~5 tools)
    ├── comments.ts            # Comment management (~5 tools)
    ├── plugins.ts             # Plugin management (~5 tools)
    └── plugin-repository.ts   # WordPress.org plugin search (~2 tools)
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
