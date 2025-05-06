# WordPress MCP Server

This is a Model Context Protocol (MCP) server for WordPress, allowing you to interact with your WordPress site using natural language via MCP-compatible clients like Claude for Desktop and Visual Studio Code. This server exposes various WordPress data and functionality as MCP tools.

## Usage

### Visual Studio Code

1. Make sure you have VS Code version 1.99 or later installed.
2. Ensure you have GitHub Copilot Chat extension installed and configured.
3. In your workspace, create a `.vscode/mcp.json` file (or use the one provided in this repository).
4. When you first use the MCP server, VS Code will prompt you for your WordPress credentials.
5. Open the Command Palette (Ctrl+Shift+P / Cmd+Shift+P) and run **MCP: List Servers** to verify the server is configured.
6. Open the Chat view (Ctrl+Alt+I / Cmd+Option+I) and select **Agent** mode from the dropdown.
7. You can now interact with your WordPress site through the chat interface.

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

*   **Posts:**
    *   `list_posts`: List all posts (supports pagination and searching).
    *   `get_post`: Retrieve a specific post by ID.
    *   `create_post`: Create a new post.
    *   `update_post`: Update an existing post.
    *   `delete_post`: Delete a post.
*   **Pages:**
    *   `list_pages`: List all pages (supports pagination and filtering).
    *   `get_page`: Retrieve a specific page by ID.
    *   `create_page`: Create a new page.
    *   `update_page`: Update an existing page.
    *   `delete_page`: Delete a page.
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
*   **Categories:**
    *   `list_categories`: List all categories with filtering, sorting, and pagination options.
    *   `get_category`: Retrieve a specific category by ID.
    *   `create_category`: Create a new category.
    *   `update_category`: Update an existing category.
    *   `delete_category`: Delete a category.
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


More features and endpoints will be added in future updates.

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
```

## Development

### Prerequisites

*   **Node.js and npm:** Ensure you have Node.js (version 18 or higher) and npm installed.
*   **WordPress Site:** You need an active WordPress site with the REST API enabled.
*   **WordPress API Authentication:** Set up authentication for the WordPress REST API. This typically requires an authentication plugin or method (like Application Passwords).
*   **MCP Client:** You need an application that can communicate with the MCP Server. Supported clients include:
    * **Visual Studio Code** (version 1.99+) with GitHub Copilot Chat extension
    * **Claude Desktop**

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

5. **Configure VS Code:**

   * Create a `.vscode/mcp.json` file in your workspace with the following content:
     ```json
     {
       "inputs": [
         {
           "type": "promptString",
           "id": "wordpress-api-url",
           "description": "WordPress API URL",
           "default": "https://your-wordpress-site.com"
         },
         {
           "type": "promptString",
           "id": "wordpress-username",
           "description": "WordPress Username"
         },
         {
           "type": "promptString",
           "id": "wordpress-password",
           "description": "WordPress Application Password",
           "password": true
         }
       ],
       "servers": {
         "WordPress MCP": {
           "type": "stdio",
           "command": "npx",
           "args": ["-y", "@instawp/mcp-wp"],
           "env": {
             "WORDPRESS_API_URL": "${input:wordpress-api-url}",
             "WORDPRESS_USERNAME": "${input:wordpress-username}",
             "WORDPRESS_PASSWORD": "${input:wordpress-password}"
           }
         }
       }
     }
     ```
   * VS Code will prompt you for your WordPress credentials when you first use the MCP server.

6. **Configure Claude Desktop (Optional):**

   * Open Claude Desktop settings and navigate to the "Developer" tab.
   * Click "Edit Config" to open the `claude_desktop_config.json` file.
   * Add a new server configuration under the `mcpServers` section. You will need to provide the **absolute** path to the `build/server.js` file and your WordPress environment variables.
   * Save the configuration.

### Running the Server

#### With VS Code

1. Open the Command Palette (Ctrl+Shift+P / Cmd+Shift+P) and run **MCP: List Servers**.
2. Select the "WordPress MCP" server and click "Start".
3. Open the Chat view (Ctrl+Alt+I / Cmd+Option+I) and select **Agent** mode from the dropdown.
4. You can now interact with your WordPress site through the chat interface.

#### With Claude Desktop

Once you've configured Claude Desktop, the server should start automatically whenever Claude Desktop starts.

#### From Command Line

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

### MCP WordPress Tools

Welcome to the MCP WordPress Tools project. This repository provides custom tools for managing WordPress functionalities, including media and plugins integration.

### Folder Structure

```
wp/
├── README.md           # This documentation file
└── src/
    └── tools/
         ├── media.ts   # Handles media operations
         └── plugins.ts # Handles plugin operations
```

### Getting Started

1. Explore the source code under the `src/tools/` directory to review how media and plugin functionalities are implemented.
2. Update or extend functionalities as needed to integrate with your WordPress workflow.

### Contribution

Feel free to open issues or make pull requests to improve this project.

## Using MCP Tools in VS Code

### VS Code Extension

This project includes a dedicated VS Code extension that makes it even easier to work with the WordPress MCP server. The extension provides:

- Easy configuration of WordPress credentials
- Commands for common WordPress operations
- Automatic MCP server management
- Seamless integration with GitHub Copilot Chat

To use the extension:

1. Navigate to the `vscode-extension` directory
2. Run `npm install` to install dependencies
3. Run `npm run compile` to build the extension
4. Press F5 in VS Code to launch a new window with the extension loaded
5. Use the "WordPress MCP: Configure Server" command to set up your WordPress credentials
6. Use the "WordPress MCP: Start Server" command to start the MCP server

For more details, see the [VS Code Extension README](./vscode-extension/README.md).

### Using with GitHub Copilot Chat

When using the WordPress MCP server with VS Code, you can interact with your WordPress site through the GitHub Copilot Chat interface in agent mode. Here are some example prompts you can use:

- "List all posts on my WordPress site"
- "Create a new page titled 'About Us' with the following content: ..."
- "Show me all active plugins on my WordPress site"
- "Upload a new media item from this URL: ..."
- "List all users with administrator role"
- "Create a new category called 'Tutorials'"
- "Update the post with ID 123 to change its title to 'New Title'"

VS Code will automatically invoke the appropriate MCP tools based on your natural language requests. You can also directly reference specific tools by using the `#` symbol followed by the tool name, for example:

- "Use #list_posts to show me all published posts"
- "Use #create_page to create a new page"

For more information on using MCP tools in VS Code, refer to the [VS Code MCP documentation](https://code.visualstudio.com/docs/copilot/chat/mcp-servers).
