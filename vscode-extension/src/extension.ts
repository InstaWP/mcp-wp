import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { spawn, ChildProcess } from 'child_process';
import { SiteProfileManager } from './siteProfileManager';
import { registerSiteCommands } from './siteCommands';
import { registerWordPressCommands } from './wordpressCommands';

let serverProcess: ChildProcess | undefined;
let outputChannel: vscode.OutputChannel;
let statusBarItem: vscode.StatusBarItem;
let siteProfileManager: SiteProfileManager;

// Server status type
type ServerStatus = 'running' | 'starting' | 'stopped' | 'error';

export function activate(context: vscode.ExtensionContext) {
  console.log('WordPress MCP extension is now active');

  // Create output channel for the extension
  outputChannel = vscode.window.createOutputChannel('WordPress MCP');

  // Initialize site profile manager
  siteProfileManager = new SiteProfileManager(context);

  // Create status bar item
  createStatusBarItem(context);

  // Register commands
  const startServerCommand = vscode.commands.registerCommand('wordpress-mcp.startServer', startServer);
  const stopServerCommand = vscode.commands.registerCommand('wordpress-mcp.stopServer', stopServer);
  const restartServerCommand = vscode.commands.registerCommand('wordpress-mcp.restartServer', restartServer);
  const configureServerCommand = vscode.commands.registerCommand('wordpress-mcp.configureServer', configureServer);
  const showQuickActionsCommand = vscode.commands.registerCommand('wordpress-mcp.showQuickActions', showQuickActions);

  // Register site profile commands
  registerSiteCommands(context, siteProfileManager);

  // Register WordPress-specific commands
  registerWordPressCommands(context);

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
    showQuickActionsCommand,
    listPostsCommand,
    createPostCommand,
    listPagesCommand,
    createPageCommand,
    listPluginsCommand,
    listMediaCommand,
    outputChannel,
    statusBarItem
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

  // Dispose of the status bar item
  if (statusBarItem) {
    statusBarItem.dispose();
  }
}

// Create and initialize the status bar item
function createStatusBarItem(context: vscode.ExtensionContext) {
  statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
  statusBarItem.command = 'wordpress-mcp.showQuickActions';
  updateStatusBar('stopped');
}

// Update the status bar appearance based on server status
function updateStatusBar(status: ServerStatus) {
  if (!statusBarItem) {
    return;
  }

  const config = vscode.workspace.getConfiguration('wordpress-mcp');
  const siteName = config.get<string>('siteName') || 'WordPress';

  switch (status) {
    case 'running':
      statusBarItem.text = `$(check) ${siteName}`;
      statusBarItem.tooltip = `WordPress MCP Server is running (${siteName})`;
      break;
    case 'starting':
      statusBarItem.text = `$(sync~spin) ${siteName}`;
      statusBarItem.tooltip = `WordPress MCP Server is starting... (${siteName})`;
      break;
    case 'error':
      statusBarItem.text = `$(error) ${siteName}`;
      statusBarItem.tooltip = `WordPress MCP Server encountered an error (${siteName})`;
      break;
    case 'stopped':
    default:
      statusBarItem.text = `$(circle-slash) ${siteName}`;
      statusBarItem.tooltip = `WordPress MCP Server is stopped (${siteName})`;
      break;
  }

  statusBarItem.show();
}

// Show quick actions menu for WordPress operations
async function showQuickActions() {
  const isRunning = !!serverProcess;
  const currentProfile = siteProfileManager.getCurrentProfile();
  const siteName = currentProfile?.name || 'WordPress';

  const actions = [
    {
      label: isRunning ? '$(stop) Stop Server' : '$(play) Start Server',
      description: isRunning ? 'Stop the WordPress MCP server' : 'Start the WordPress MCP server',
      action: isRunning ? 'stop' : 'start'
    },
    {
      label: '$(refresh) Restart Server',
      description: 'Restart the WordPress MCP server',
      action: 'restart'
    },
    {
      label: '$(gear) Configure Server',
      description: 'Configure WordPress credentials',
      action: 'configure'
    },
    {
      label: '$(output) Show Server Output',
      description: 'Show the server output log',
      action: 'output'
    },
    { kind: vscode.QuickPickItemKind.Separator, label: 'Site Profiles' },
    {
      label: '$(globe) Switch Site',
      description: `Current: ${siteName}`,
      action: 'switchSite'
    },
    {
      label: '$(add) Add Site Profile',
      description: 'Add a new WordPress site profile',
      action: 'addSite'
    },
    {
      label: '$(edit) Edit Site Profile',
      description: 'Edit an existing WordPress site profile',
      action: 'editSite'
    },
    {
      label: '$(list-unordered) List Site Profiles',
      description: 'View all WordPress site profiles',
      action: 'listSites'
    },
    { kind: vscode.QuickPickItemKind.Separator, label: 'WordPress Content' },
    {
      label: '$(file-text) List Posts',
      description: 'List all posts on your WordPress site',
      action: 'listPosts'
    },
    {
      label: '$(new-file) Create New Post',
      description: 'Create a new post on your WordPress site',
      action: 'createPost'
    },
    {
      label: '$(file) List Pages',
      description: 'List all pages on your WordPress site',
      action: 'listPages'
    },
    {
      label: '$(new-file) Create New Page',
      description: 'Create a new page on your WordPress site',
      action: 'createPage'
    },
    {
      label: '$(extensions) List Plugins',
      description: 'List all plugins on your WordPress site',
      action: 'listPlugins'
    },
    {
      label: '$(file-media) List Media',
      description: 'List all media items on your WordPress site',
      action: 'listMedia'
    },
    { kind: vscode.QuickPickItemKind.Separator, label: 'Advanced WordPress' },
    {
      label: '$(paintcan) Browse Themes',
      description: 'Browse and preview WordPress themes',
      action: 'browseThemes'
    },
    {
      label: '$(bug) Toggle Debug Mode',
      description: 'Enable or disable WordPress debug mode',
      action: 'toggleDebugMode'
    },
    {
      label: '$(database) Run SQL Query',
      description: 'Run an SQL query against the WordPress database',
      action: 'runSqlQuery'
    },
    {
      label: '$(person) Manage Users',
      description: 'Manage WordPress users',
      action: 'manageUsers'
    },
    {
      label: '$(pulse) Site Health Check',
      description: 'Run a WordPress site health check',
      action: 'siteHealthCheck'
    },
    {
      label: '$(clear-all) Clear Cache',
      description: 'Clear WordPress caches',
      action: 'clearCache'
    }
  ];

  const selectedItem = await vscode.window.showQuickPick(actions, {
    placeHolder: 'Select a WordPress MCP action'
  });

  if (!selectedItem) {
    return; // User cancelled
  }

  // Execute the selected action
  switch (selectedItem.action) {
    case 'start':
      startServer();
      break;
    case 'stop':
      stopServer();
      break;
    case 'restart':
      restartServer();
      break;
    case 'configure':
      configureServer();
      break;
    case 'output':
      outputChannel.show();
      break;
    // Site profile actions
    case 'switchSite':
      vscode.commands.executeCommand('wordpress-mcp.switchSiteProfile');
      break;
    case 'addSite':
      vscode.commands.executeCommand('wordpress-mcp.addSiteProfile');
      break;
    case 'editSite':
      vscode.commands.executeCommand('wordpress-mcp.editSiteProfile');
      break;
    case 'listSites':
      vscode.commands.executeCommand('wordpress-mcp.listSiteProfiles');
      break;
    // WordPress content actions
    case 'listPosts':
      listPosts();
      break;
    case 'createPost':
      createPost();
      break;
    case 'listPages':
      listPages();
      break;
    case 'createPage':
      createPage();
      break;
    case 'listPlugins':
      listPlugins();
      break;
    case 'listMedia':
      listMedia();
      break;
    // Advanced WordPress actions
    case 'browseThemes':
      vscode.commands.executeCommand('wordpress-mcp.browseThemes');
      break;
    case 'toggleDebugMode':
      vscode.commands.executeCommand('wordpress-mcp.toggleDebugMode');
      break;
    case 'runSqlQuery':
      vscode.commands.executeCommand('wordpress-mcp.runSqlQuery');
      break;
    case 'manageUsers':
      vscode.commands.executeCommand('wordpress-mcp.manageUsers');
      break;
    case 'siteHealthCheck':
      vscode.commands.executeCommand('wordpress-mcp.siteHealthCheck');
      break;
    case 'clearCache':
      vscode.commands.executeCommand('wordpress-mcp.clearCache');
      break;
  }
}

async function startServer() {
  if (serverProcess) {
    vscode.window.showInformationMessage('WordPress MCP server is already running');
    return;
  }

  try {
    // Update status bar to show starting state
    updateStatusBar('starting');

    // Get configuration
    const config = vscode.workspace.getConfiguration('wordpress-mcp');
    const apiUrl = config.get<string>('apiUrl');
    const username = config.get<string>('username');
    const password = config.get<string>('password');

    // Check if configuration is complete
    if (!apiUrl || !username || !password) {
      updateStatusBar('stopped');
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
      const output = data.toString();
      outputChannel.append(output);

      // Check for successful startup message
      if (output.includes('WordPress MCP Server running') ||
          output.includes('initialized successfully')) {
        updateStatusBar('running');
      }
    });

    serverProcess.stderr?.on('data', (data) => {
      outputChannel.append(data.toString());
      // If we get stderr output, there might be an issue
      if (!data.toString().includes('warning')) { // Ignore warnings
        updateStatusBar('error');
      }
    });

    // Handle server exit
    serverProcess.on('close', (code) => {
      outputChannel.appendLine(`WordPress MCP server exited with code ${code}`);
      serverProcess = undefined;
      updateStatusBar('stopped');

      if (code !== 0) {
        vscode.window.showErrorMessage(`WordPress MCP server exited with code ${code}`);
      }
    });

    // Set a timeout to check if server started successfully
    setTimeout(() => {
      if (serverProcess) {
        vscode.window.showInformationMessage('WordPress MCP server started');
        updateStatusBar('running');
      }
    }, 3000);

    outputChannel.show();

  } catch (error) {
    updateStatusBar('error');
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
    updateStatusBar('stopped');
    serverProcess.kill();
    serverProcess = undefined;
    vscode.window.showInformationMessage('WordPress MCP server stopped');
  } catch (error) {
    updateStatusBar('error');
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
  // Check if we have any profiles
  const profiles = siteProfileManager.getProfiles();
  const currentProfile = siteProfileManager.getCurrentProfile();

  if (profiles.length === 0) {
    // No profiles exist, create one
    const createProfile = 'Create Profile';
    const response = await vscode.window.showInformationMessage(
      'No WordPress site profiles found. Would you like to create one?',
      createProfile, 'Cancel'
    );

    if (response === createProfile) {
      vscode.commands.executeCommand('wordpress-mcp.addSiteProfile');
    }
    return;
  }

  // If we have multiple profiles, ask which one to configure
  if (profiles.length > 1 && !currentProfile) {
    const switchProfile = 'Switch Profile';
    const response = await vscode.window.showInformationMessage(
      'Multiple WordPress site profiles found. Would you like to switch to a specific profile?',
      switchProfile, 'Cancel'
    );

    if (response === switchProfile) {
      vscode.commands.executeCommand('wordpress-mcp.switchSiteProfile');
    }
    return;
  }

  // If we have a current profile, edit it
  if (currentProfile) {
    vscode.commands.executeCommand('wordpress-mcp.editSiteProfile');
    return;
  }

  // If we have only one profile, use it
  if (profiles.length === 1) {
    await siteProfileManager.switchProfile(profiles[0].id);
    vscode.commands.executeCommand('wordpress-mcp.editSiteProfile');
    return;
  }

  // Fallback to the old configuration method
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

  // Ask for a site name
  const name = await vscode.window.showInputBox({
    prompt: 'Enter a name for this WordPress site',
    value: 'My WordPress Site'
  });

  if (name === undefined) return; // User cancelled

  // Create a new profile
  try {
    const profile = await siteProfileManager.addProfile({
      name,
      apiUrl,
      username,
      password
    });

    vscode.window.showInformationMessage(`WordPress site "${name}" added successfully`);

    // Ask if user wants to start the server
    const startNow = 'Start Now';
    const response = await vscode.window.showInformationMessage(
      'Do you want to start the WordPress MCP server now?',
      startNow, 'Later'
    );

    if (response === startNow) {
      startServer();
    }
  } catch (error) {
    vscode.window.showErrorMessage(`Failed to add WordPress site: ${error}`);
  }
}

// Ensure the .vscode/mcp.json file exists and is up to date
function ensureMcpConfig(context: vscode.ExtensionContext) {
  if (!vscode.workspace.workspaceFolders || vscode.workspace.workspaceFolders.length === 0) {
    return; // No workspace open
  }

  // Check if we have a current profile
  const currentProfile = siteProfileManager.getCurrentProfile();

  if (currentProfile) {
    // Use the current profile to update the MCP config
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
          "default": currentProfile.apiUrl
        },
        {
          "type": "promptString",
          "id": "wordpress-username",
          "description": "WordPress Username",
          "default": currentProfile.username
        },
        {
          "type": "promptString",
          "id": "wordpress-password",
          "description": "WordPress Application Password",
          "password": true,
          "default": currentProfile.password
        }
      ],
      "servers": {
        [`WordPress MCP - ${currentProfile.name}`]: {
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
  } else {
    // No profile exists, create a default MCP config
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
