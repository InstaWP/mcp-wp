# WordPress MCP for VS Code

This extension integrates WordPress with Visual Studio Code using the Machine Conversation Protocol (MCP). It allows you to interact with your WordPress site directly from VS Code using natural language through GitHub Copilot Chat.

## Features

- Seamless integration with GitHub Copilot Chat in VS Code
- Easy configuration of WordPress credentials
- Commands for common WordPress operations
- Automatic MCP server management

## Requirements

- Visual Studio Code 1.99.0 or higher
- GitHub Copilot Chat extension
- Node.js 18.0.0 or higher
- A WordPress site with REST API enabled
- WordPress application password for authentication

## Installation

1. Install this extension from the VS Code Marketplace
2. Configure your WordPress credentials using the "WordPress MCP: Configure Server" command
3. Start the MCP server using the "WordPress MCP: Start Server" command

## Usage

### Configuration

1. Open the Command Palette (Ctrl+Shift+P / Cmd+Shift+P)
2. Run "WordPress MCP: Configure Server"
3. Enter your WordPress API URL, username, and application password

### Starting the Server

1. Open the Command Palette
2. Run "WordPress MCP: Start Server"

### Using with GitHub Copilot Chat

1. Open the Chat view (Ctrl+Alt+I / Cmd+Option+I)
2. Select "Agent" mode from the dropdown
3. Enter natural language queries about your WordPress site

Example queries:
- "List all posts on my WordPress site"
- "Create a new page titled 'About Us'"
- "Show me all active plugins"
- "Upload a new media item from this URL: ..."

### Quick Commands

This extension provides several commands for common WordPress operations:

- **WordPress MCP: List Posts** - Shows all posts on your site
- **WordPress MCP: Create New Post** - Creates a new post
- **WordPress MCP: List Pages** - Shows all pages on your site
- **WordPress MCP: Create New Page** - Creates a new page
- **WordPress MCP: List Plugins** - Shows all plugins on your site
- **WordPress MCP: List Media** - Shows all media items on your site

## Extension Settings

This extension contributes the following settings:

* `wordpress-mcp.apiUrl`: WordPress API URL
* `wordpress-mcp.username`: WordPress Username
* `wordpress-mcp.password`: WordPress Application Password
* `wordpress-mcp.autoStart`: Automatically start the WordPress MCP server when VS Code starts

## Known Issues

- The extension requires GitHub Copilot Chat to be installed and configured
- Some WordPress operations may require administrator privileges

## Release Notes

### 0.1.0

Initial release of WordPress MCP for VS Code

## Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

## License

This extension is licensed under the GPL-3.0 License.

---

**Powered by [InstaWP](https://instawp.com/)**
