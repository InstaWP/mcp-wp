import * as vscode from 'vscode';

/**
 * Register additional WordPress-specific commands
 */
export function registerWordPressCommands(context: vscode.ExtensionContext) {
  // Theme management commands
  const browsethemesCommand = vscode.commands.registerCommand('wordpress-mcp.browseThemes', browseThemes);
  const activateThemeCommand = vscode.commands.registerCommand('wordpress-mcp.activateTheme', activateTheme);
  
  // Debug commands
  const toggleDebugCommand = vscode.commands.registerCommand('wordpress-mcp.toggleDebugMode', toggleDebugMode);
  const viewDebugLogsCommand = vscode.commands.registerCommand('wordpress-mcp.viewDebugLogs', viewDebugLogs);
  
  // Database commands
  const runSqlQueryCommand = vscode.commands.registerCommand('wordpress-mcp.runSqlQuery', runSqlQuery);
  const optimizeDatabaseCommand = vscode.commands.registerCommand('wordpress-mcp.optimizeDatabase', optimizeDatabase);
  
  // User management commands
  const manageUsersCommand = vscode.commands.registerCommand('wordpress-mcp.manageUsers', manageUsers);
  const createUserCommand = vscode.commands.registerCommand('wordpress-mcp.createUser', createUser);
  
  // Site health commands
  const siteHealthCheckCommand = vscode.commands.registerCommand('wordpress-mcp.siteHealthCheck', siteHealthCheck);
  const clearCacheCommand = vscode.commands.registerCommand('wordpress-mcp.clearCache', clearCache);
  
  // Add commands to subscriptions
  context.subscriptions.push(
    browsethemesCommand,
    activateThemeCommand,
    toggleDebugCommand,
    viewDebugLogsCommand,
    runSqlQueryCommand,
    optimizeDatabaseCommand,
    manageUsersCommand,
    createUserCommand,
    siteHealthCheckCommand,
    clearCacheCommand
  );
}

/**
 * Helper function to open Copilot Chat with a specific prompt
 */
async function openChatWithPrompt(prompt: string) {
  // First, make sure the chat view is open
  await vscode.commands.executeCommand('workbench.action.chat.open');
  
  // Then, set the chat to agent mode
  await vscode.commands.executeCommand('workbench.action.chat.selectMode', 'agent');
  
  // Finally, send the prompt
  await vscode.commands.executeCommand('workbench.action.chat.sendRequest', prompt);
}

/**
 * Browse and preview themes
 */
async function browseThemes() {
  await openChatWithPrompt("List all themes on my WordPress site and show their details");
}

/**
 * Activate a theme
 */
async function activateTheme() {
  const themeName = await vscode.window.showInputBox({
    prompt: 'Enter the theme name to activate',
    placeHolder: 'twentytwentyfour'
  });
  
  if (!themeName) return; // User cancelled
  
  await openChatWithPrompt(`Activate the WordPress theme "${themeName}"`);
}

/**
 * Toggle WordPress debug mode
 */
async function toggleDebugMode() {
  const options = ['Enable', 'Disable'];
  const selected = await vscode.window.showQuickPick(options, {
    placeHolder: 'Enable or disable WordPress debug mode?'
  });
  
  if (!selected) return; // User cancelled
  
  const action = selected === 'Enable' ? 'enable' : 'disable';
  await openChatWithPrompt(`${action} WordPress debug mode`);
}

/**
 * View WordPress debug logs
 */
async function viewDebugLogs() {
  await openChatWithPrompt("Show the WordPress debug logs");
}

/**
 * Run an SQL query against the WordPress database
 */
async function runSqlQuery() {
  const query = await vscode.window.showInputBox({
    prompt: 'Enter SQL query to run',
    placeHolder: 'SELECT * FROM wp_posts LIMIT 10',
    validateInput: (value) => {
      return value.trim() ? null : 'SQL query is required';
    }
  });
  
  if (!query) return; // User cancelled
  
  await openChatWithPrompt(`Run the following SQL query against the WordPress database: ${query}`);
}

/**
 * Optimize the WordPress database
 */
async function optimizeDatabase() {
  const confirm = await vscode.window.showWarningMessage(
    'This will optimize the WordPress database tables. Continue?',
    { modal: true },
    'Optimize', 'Cancel'
  );
  
  if (confirm !== 'Optimize') return; // User cancelled
  
  await openChatWithPrompt("Optimize the WordPress database tables");
}

/**
 * Manage WordPress users
 */
async function manageUsers() {
  const options = [
    'List all users',
    'List administrators',
    'List editors',
    'List authors',
    'List contributors',
    'List subscribers'
  ];
  
  const selected = await vscode.window.showQuickPick(options, {
    placeHolder: 'Select a user management action'
  });
  
  if (!selected) return; // User cancelled
  
  await openChatWithPrompt(selected);
}

/**
 * Create a new WordPress user
 */
async function createUser() {
  // Get username
  const username = await vscode.window.showInputBox({
    prompt: 'Enter username',
    validateInput: (value) => {
      return value.trim() ? null : 'Username is required';
    }
  });
  
  if (!username) return; // User cancelled
  
  // Get email
  const email = await vscode.window.showInputBox({
    prompt: 'Enter email address',
    validateInput: (value) => {
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      return emailRegex.test(value) ? null : 'Please enter a valid email address';
    }
  });
  
  if (!email) return; // User cancelled
  
  // Get role
  const roles = ['administrator', 'editor', 'author', 'contributor', 'subscriber'];
  const role = await vscode.window.showQuickPick(roles, {
    placeHolder: 'Select user role'
  });
  
  if (!role) return; // User cancelled
  
  await openChatWithPrompt(`Create a new WordPress user with username "${username}", email "${email}", and role "${role}"`);
}

/**
 * Run a site health check
 */
async function siteHealthCheck() {
  await openChatWithPrompt("Run a WordPress site health check and show the results");
}

/**
 * Clear WordPress caches
 */
async function clearCache() {
  const options = [
    'Clear all caches',
    'Clear object cache',
    'Clear page cache',
    'Clear transients'
  ];
  
  const selected = await vscode.window.showQuickPick(options, {
    placeHolder: 'Select which cache to clear'
  });
  
  if (!selected) return; // User cancelled
  
  await openChatWithPrompt(`${selected} in WordPress`);
}
