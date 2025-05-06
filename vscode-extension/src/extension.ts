import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { spawn, ChildProcess } from 'child_process';

let serverProcess: ChildProcess | undefined;
let outputChannel: vscode.OutputChannel;

export function activate(context: vscode.ExtensionContext) {
  console.log('WordPress MCP extension is now active');
  
  // Create output channel for the extension
  outputChannel = vscode.window.createOutputChannel('WordPress MCP');
  
  // Register commands
  const startServerCommand = vscode.commands.registerCommand('wordpress-mcp.startServer', startServer);
  const stopServerCommand = vscode.commands.registerCommand('wordpress-mcp.stopServer', stopServer);
  const restartServerCommand = vscode.commands.registerCommand('wordpress-mcp.restartServer', restartServer);
  const configureServerCommand = vscode.commands.registerCommand('wordpress-mcp.configureServer', configureServer);
  
  // Register WordPress-specific commands
  const listPostsCommand = vscode.commands.registerCommand('wordpress-mcp.listPosts', listPosts);
  const createPostCommand = vscode.commands.registerCommand('wordpress-mcp.createPost', createPost);
  const listPagesCommand = vscode.commands.registerCommand('wordpress-mcp.listPages', listPages);
  const createPageCommand = vscode.commands.registerCommand('wordpress-mcp.createPage', createPage);
  const listPluginsCommand = vscode.commands.registerCommand('wordpress-mcp.listPlugins', listPlugins);
  const listMediaCommand = vscode.commands.registerCommand('wordpress-mcp.listMedia', listMedia);
  
  // Add commands to subscriptions
  context.subscriptions.push(
    startServerCommand,
    stopServerCommand,
    restartServerCommand,
    configureServerCommand,
    listPostsCommand,
    createPostCommand,
    listPagesCommand,
    createPageCommand,
    listPluginsCommand,
    listMediaCommand,
    outputChannel
  );
  
  // Auto-start server if configured
  const config = vscode.workspace.getConfiguration('wordpress-mcp');
  if (config.get<boolean>('autoStart')) {
    startServer();
  }
  
  // Create or update MCP configuration file
  ensureMcpConfig(context);
}

export function deactivate() {
  // Stop the server when the extension is deactivated
  stopServer();
}

async function startServer() {
  if (serverProcess) {
    vscode.window.showInformationMessage('WordPress MCP server is already running');
    return;
  }
  
  try {
    // Get configuration
    const config = vscode.workspace.getConfiguration('wordpress-mcp');
    const apiUrl = config.get<string>('apiUrl');
    const username = config.get<string>('username');
    const password = config.get<string>('password');
    
    // Check if configuration is complete
    if (!apiUrl || !username || !password) {
      const configureNow = 'Configure Now';
      const response = await vscode.window.showWarningMessage(
        'WordPress MCP server is not fully configured. Please configure it before starting.',
        configureNow
      );
      
      if (response === configureNow) {
        configureServer();
      }
      return;
    }
    
    // Start the server process
    outputChannel.appendLine('Starting WordPress MCP server...');
    
    // Use npx to run the MCP server
    serverProcess = spawn('npx', ['-y', '@instawp/mcp-wp'], {
      env: {
        ...process.env,
        WORDPRESS_API_URL: apiUrl,
        WORDPRESS_USERNAME: username,
        WORDPRESS_PASSWORD: password
      }
    });
    
    // Handle server output
    serverProcess.stdout?.on('data', (data) => {
      outputChannel.append(data.toString());
    });
    
    serverProcess.stderr?.on('data', (data) => {
      outputChannel.append(data.toString());
    });
    
    // Handle server exit
    serverProcess.on('close', (code) => {
      outputChannel.appendLine(`WordPress MCP server exited with code ${code}`);
      serverProcess = undefined;
    });
    
    vscode.window.showInformationMessage('WordPress MCP server started');
    outputChannel.show();
    
  } catch (error) {
    vscode.window.showErrorMessage(`Failed to start WordPress MCP server: ${error}`);
    outputChannel.appendLine(`Error: ${error}`);
  }
}

function stopServer() {
  if (!serverProcess) {
    vscode.window.showInformationMessage('WordPress MCP server is not running');
    return;
  }
  
  try {
    outputChannel.appendLine('Stopping WordPress MCP server...');
    serverProcess.kill();
    serverProcess = undefined;
    vscode.window.showInformationMessage('WordPress MCP server stopped');
  } catch (error) {
    vscode.window.showErrorMessage(`Failed to stop WordPress MCP server: ${error}`);
    outputChannel.appendLine(`Error: ${error}`);
  }
}

async function restartServer() {
  await stopServer();
  setTimeout(() => {
    startServer();
  }, 1000); // Wait for 1 second before restarting
}

async function configureServer() {
  // Get current configuration
  const config = vscode.workspace.getConfiguration('wordpress-mcp');
  
  // Prompt for API URL
  const apiUrl = await vscode.window.showInputBox({
    prompt: 'Enter WordPress API URL',
    value: config.get<string>('apiUrl') || '',
    placeHolder: 'https://your-wordpress-site.com'
  });
  
  if (apiUrl === undefined) return; // User cancelled
  
  // Prompt for username
  const username = await vscode.window.showInputBox({
    prompt: 'Enter WordPress Username',
    value: config.get<string>('username') || ''
  });
  
  if (username === undefined) return; // User cancelled
  
  // Prompt for password
  const password = await vscode.window.showInputBox({
    prompt: 'Enter WordPress Application Password',
    value: config.get<string>('password') || '',
    password: true
  });
  
  if (password === undefined) return; // User cancelled
  
  // Save configuration
  await config.update('apiUrl', apiUrl, vscode.ConfigurationTarget.Global);
  await config.update('username', username, vscode.ConfigurationTarget.Global);
  await config.update('password', password, vscode.ConfigurationTarget.Global);
  
  vscode.window.showInformationMessage('WordPress MCP server configuration saved');
  
  // Ask if user wants to start the server
  const startNow = 'Start Now';
  const response = await vscode.window.showInformationMessage(
    'Do you want to start the WordPress MCP server now?',
    startNow, 'Later'
  );
  
  if (response === startNow) {
    startServer();
  }
}

// Ensure the .vscode/mcp.json file exists and is up to date
function ensureMcpConfig(context: vscode.ExtensionContext) {
  if (!vscode.workspace.workspaceFolders || vscode.workspace.workspaceFolders.length === 0) {
    return; // No workspace open
  }
  
  const workspaceFolder = vscode.workspace.workspaceFolders[0].uri.fsPath;
  const vscodeFolder = path.join(workspaceFolder, '.vscode');
  const mcpConfigPath = path.join(vscodeFolder, 'mcp.json');
  
  // Create .vscode folder if it doesn't exist
  if (!fs.existsSync(vscodeFolder)) {
    fs.mkdirSync(vscodeFolder, { recursive: true });
  }
  
  // Create or update mcp.json
  const mcpConfig = {
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
  };
  
  fs.writeFileSync(mcpConfigPath, JSON.stringify(mcpConfig, null, 2));
}

// WordPress-specific commands that use the Copilot Chat interface
async function listPosts() {
  await openChatWithPrompt("List all posts on my WordPress site");
}

async function createPost() {
  const title = await vscode.window.showInputBox({
    prompt: 'Enter post title',
    placeHolder: 'My New Post'
  });
  
  if (!title) return; // User cancelled
  
  await openChatWithPrompt(`Create a new post titled "${title}" on my WordPress site`);
}

async function listPages() {
  await openChatWithPrompt("List all pages on my WordPress site");
}

async function createPage() {
  const title = await vscode.window.showInputBox({
    prompt: 'Enter page title',
    placeHolder: 'About Us'
  });
  
  if (!title) return; // User cancelled
  
  await openChatWithPrompt(`Create a new page titled "${title}" on my WordPress site`);
}

async function listPlugins() {
  await openChatWithPrompt("List all plugins on my WordPress site");
}

async function listMedia() {
  await openChatWithPrompt("List all media items on my WordPress site");
}

// Helper function to open Copilot Chat with a specific prompt
async function openChatWithPrompt(prompt: string) {
  // First, make sure the chat view is open
  await vscode.commands.executeCommand('workbench.action.chat.open');
  
  // Then, set the chat to agent mode
  await vscode.commands.executeCommand('workbench.action.chat.selectMode', 'agent');
  
  // Finally, send the prompt
  await vscode.commands.executeCommand('workbench.action.chat.sendRequest', prompt);
}
