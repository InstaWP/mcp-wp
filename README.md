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

This server currently provides tools to interact with core WordPress data:

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
*   **Database Queries:**
  *   `execute_sql_query`: Execute read-only SQL queries against the WordPress database (requires custom endpoint setup).

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
```

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

    Create a `.env` file in the root of your project directory and add your WordPress API credentials:

    ```env
    WORDPRESS_API_URL=https://your-wordpress-site.com
    WORDPRESS_USERNAME=wp_username
    WORDPRESS_PASSWORD=wp_app_password
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

```text
src/
├── server.ts                    # MCP server entry point
├── wordpress.ts                 # WordPress REST API client
├── cli.ts                      # CLI interface
├── types/
│   └── wordpress-types.ts      # TypeScript definitions
└── tools/
    ├── index.ts                # Tool aggregation
    ├── unified-content.ts      # Universal content management (8 tools)
    ├── unified-taxonomies.ts   # Universal taxonomy management (8 tools)
    ├── media.ts               # Media management (~5 tools)
    ├── users.ts               # User management (~5 tools)
    ├── comments.ts            # Comment management (~5 tools)
    ├── plugins.ts             # Plugin management (~5 tools)
    ├── plugin-repository.ts   # WordPress.org plugin search (~2 tools)
    └── sql-query.ts           # Database queries (1 tool)
```

### Key Features

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
