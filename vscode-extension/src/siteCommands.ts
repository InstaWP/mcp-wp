import * as vscode from 'vscode';
import { SiteProfileManager, WordPressSiteProfile } from './siteProfileManager';

/**
 * Register commands for managing WordPress site profiles
 */
export function registerSiteCommands(context: vscode.ExtensionContext, profileManager: SiteProfileManager) {
  // Add a new site profile
  const addSiteCommand = vscode.commands.registerCommand('wordpress-mcp.addSiteProfile', async () => {
    await addSiteProfile(profileManager);
  });
  
  // Edit an existing site profile
  const editSiteCommand = vscode.commands.registerCommand('wordpress-mcp.editSiteProfile', async () => {
    await editSiteProfile(profileManager);
  });
  
  // Delete a site profile
  const deleteSiteCommand = vscode.commands.registerCommand('wordpress-mcp.deleteSiteProfile', async () => {
    await deleteSiteProfile(profileManager);
  });
  
  // Switch between site profiles
  const switchSiteCommand = vscode.commands.registerCommand('wordpress-mcp.switchSiteProfile', async () => {
    await switchSiteProfile(profileManager);
  });
  
  // List all site profiles
  const listSitesCommand = vscode.commands.registerCommand('wordpress-mcp.listSiteProfiles', async () => {
    await listSiteProfiles(profileManager);
  });
  
  // Add commands to subscriptions
  context.subscriptions.push(
    addSiteCommand,
    editSiteCommand,
    deleteSiteCommand,
    switchSiteCommand,
    listSitesCommand
  );
}

/**
 * Add a new WordPress site profile
 */
async function addSiteProfile(profileManager: SiteProfileManager): Promise<void> {
  // Get site name
  const name = await vscode.window.showInputBox({
    prompt: 'Enter a name for this WordPress site',
    placeHolder: 'My WordPress Site',
    validateInput: (value) => {
      return value.trim() ? null : 'Site name is required';
    }
  });
  
  if (!name) {
    return; // User cancelled
  }
  
  // Get API URL
  const apiUrl = await vscode.window.showInputBox({
    prompt: 'Enter the WordPress API URL',
    placeHolder: 'https://your-wordpress-site.com',
    validateInput: (value) => {
      try {
        new URL(value);
        return null;
      } catch (e) {
        return 'Please enter a valid URL';
      }
    }
  });
  
  if (!apiUrl) {
    return; // User cancelled
  }
  
  // Get username
  const username = await vscode.window.showInputBox({
    prompt: 'Enter WordPress Username',
    validateInput: (value) => {
      return value.trim() ? null : 'Username is required';
    }
  });
  
  if (!username) {
    return; // User cancelled
  }
  
  // Get password
  const password = await vscode.window.showInputBox({
    prompt: 'Enter WordPress Application Password',
    password: true,
    validateInput: (value) => {
      return value.trim() ? null : 'Password is required';
    }
  });
  
  if (!password) {
    return; // User cancelled
  }
  
  // Create the profile
  try {
    const profile = await profileManager.addProfile({
      name,
      apiUrl,
      username,
      password
    });
    
    vscode.window.showInformationMessage(`WordPress site "${name}" added successfully`);
    
    // Ask if user wants to switch to this profile
    const switchNow = 'Switch Now';
    const response = await vscode.window.showInformationMessage(
      `Do you want to switch to "${name}" now?`,
      switchNow, 'Later'
    );
    
    if (response === switchNow) {
      await profileManager.switchProfile(profile.id);
      vscode.window.showInformationMessage(`Switched to WordPress site "${name}"`);
    }
  } catch (error) {
    vscode.window.showErrorMessage(`Failed to add WordPress site: ${error}`);
  }
}

/**
 * Edit an existing WordPress site profile
 */
async function editSiteProfile(profileManager: SiteProfileManager): Promise<void> {
  const profiles = profileManager.getProfiles();
  
  if (profiles.length === 0) {
    vscode.window.showInformationMessage('No WordPress site profiles found. Add one first.');
    return;
  }
  
  // Let user select a profile to edit
  const items = profiles.map(p => ({
    label: p.name,
    description: p.apiUrl,
    detail: p.isDefault ? 'Default site' : undefined,
    profile: p
  }));
  
  const selected = await vscode.window.showQuickPick(items, {
    placeHolder: 'Select a WordPress site to edit'
  });
  
  if (!selected) {
    return; // User cancelled
  }
  
  const profile = selected.profile;
  
  // Get updated site name
  const name = await vscode.window.showInputBox({
    prompt: 'Enter a name for this WordPress site',
    value: profile.name,
    validateInput: (value) => {
      return value.trim() ? null : 'Site name is required';
    }
  });
  
  if (!name) {
    return; // User cancelled
  }
  
  // Get updated API URL
  const apiUrl = await vscode.window.showInputBox({
    prompt: 'Enter the WordPress API URL',
    value: profile.apiUrl,
    validateInput: (value) => {
      try {
        new URL(value);
        return null;
      } catch (e) {
        return 'Please enter a valid URL';
      }
    }
  });
  
  if (!apiUrl) {
    return; // User cancelled
  }
  
  // Get updated username
  const username = await vscode.window.showInputBox({
    prompt: 'Enter WordPress Username',
    value: profile.username,
    validateInput: (value) => {
      return value.trim() ? null : 'Username is required';
    }
  });
  
  if (!username) {
    return; // User cancelled
  }
  
  // Get updated password
  const password = await vscode.window.showInputBox({
    prompt: 'Enter WordPress Application Password (leave empty to keep current)',
    password: true
  });
  
  if (password === undefined) {
    return; // User cancelled
  }
  
  // Update the profile
  try {
    await profileManager.updateProfile(profile.id, {
      name,
      apiUrl,
      username,
      ...(password ? { password } : {})
    });
    
    vscode.window.showInformationMessage(`WordPress site "${name}" updated successfully`);
    
    // If this is the current profile, ask if user wants to reload settings
    const currentProfile = profileManager.getCurrentProfile();
    if (currentProfile && currentProfile.id === profile.id) {
      const reloadNow = 'Reload Now';
      const response = await vscode.window.showInformationMessage(
        `Do you want to reload the settings for "${name}" now?`,
        reloadNow, 'Later'
      );
      
      if (response === reloadNow) {
        await profileManager.switchProfile(profile.id);
        vscode.window.showInformationMessage(`Reloaded settings for WordPress site "${name}"`);
      }
    }
  } catch (error) {
    vscode.window.showErrorMessage(`Failed to update WordPress site: ${error}`);
  }
}

/**
 * Delete a WordPress site profile
 */
async function deleteSiteProfile(profileManager: SiteProfileManager): Promise<void> {
  const profiles = profileManager.getProfiles();
  
  if (profiles.length === 0) {
    vscode.window.showInformationMessage('No WordPress site profiles found.');
    return;
  }
  
  // Let user select a profile to delete
  const items = profiles.map(p => ({
    label: p.name,
    description: p.apiUrl,
    detail: p.isDefault ? 'Default site' : undefined,
    profile: p
  }));
  
  const selected = await vscode.window.showQuickPick(items, {
    placeHolder: 'Select a WordPress site to delete'
  });
  
  if (!selected) {
    return; // User cancelled
  }
  
  const profile = selected.profile;
  
  // Confirm deletion
  const confirmDelete = 'Delete';
  const response = await vscode.window.showWarningMessage(
    `Are you sure you want to delete the WordPress site "${profile.name}"?`,
    { modal: true },
    confirmDelete, 'Cancel'
  );
  
  if (response !== confirmDelete) {
    return; // User cancelled
  }
  
  // Delete the profile
  try {
    await profileManager.deleteProfile(profile.id);
    vscode.window.showInformationMessage(`WordPress site "${profile.name}" deleted successfully`);
  } catch (error) {
    vscode.window.showErrorMessage(`Failed to delete WordPress site: ${error}`);
  }
}

/**
 * Switch between WordPress site profiles
 */
async function switchSiteProfile(profileManager: SiteProfileManager): Promise<void> {
  const profiles = profileManager.getProfiles();
  
  if (profiles.length === 0) {
    vscode.window.showInformationMessage('No WordPress site profiles found. Add one first.');
    return;
  }
  
  const currentProfile = profileManager.getCurrentProfile();
  
  // Let user select a profile to switch to
  const items = profiles.map(p => ({
    label: p.name,
    description: p.apiUrl,
    detail: p.id === currentProfile?.id ? 'Current site' : (p.isDefault ? 'Default site' : undefined),
    profile: p
  }));
  
  const selected = await vscode.window.showQuickPick(items, {
    placeHolder: 'Select a WordPress site to switch to'
  });
  
  if (!selected) {
    return; // User cancelled
  }
  
  const profile = selected.profile;
  
  // Switch to the selected profile
  try {
    await profileManager.switchProfile(profile.id);
    vscode.window.showInformationMessage(`Switched to WordPress site "${profile.name}"`);
  } catch (error) {
    vscode.window.showErrorMessage(`Failed to switch WordPress site: ${error}`);
  }
}

/**
 * List all WordPress site profiles
 */
async function listSiteProfiles(profileManager: SiteProfileManager): Promise<void> {
  const profiles = profileManager.getProfiles();
  
  if (profiles.length === 0) {
    vscode.window.showInformationMessage('No WordPress site profiles found. Add one first.');
    return;
  }
  
  const currentProfile = profileManager.getCurrentProfile();
  
  // Create a markdown table of profiles
  const tableHeader = '| Name | URL | Status |\n| ---- | --- | ------ |\n';
  const tableRows = profiles.map(p => {
    const status = [];
    if (p.id === currentProfile?.id) {
      status.push('Current');
    }
    if (p.isDefault) {
      status.push('Default');
    }
    
    return `| ${p.name} | ${p.apiUrl} | ${status.join(', ') || '-'} |`;
  }).join('\n');
  
  const markdown = `# WordPress Site Profiles\n\n${tableHeader}${tableRows}`;
  
  // Show the profiles in a webview
  const panel = vscode.window.createWebviewPanel(
    'wordpressSiteProfiles',
    'WordPress Site Profiles',
    vscode.ViewColumn.One,
    {
      enableScripts: false
    }
  );
  
  panel.webview.html = `
    <!DOCTYPE html>
    <html lang="en">
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>WordPress Site Profiles</title>
      <style>
        body {
          font-family: var(--vscode-font-family);
          padding: 20px;
        }
        table {
          border-collapse: collapse;
          width: 100%;
        }
        th, td {
          border: 1px solid var(--vscode-panel-border);
          padding: 8px;
          text-align: left;
        }
        th {
          background-color: var(--vscode-editor-background);
        }
      </style>
    </head>
    <body>
      <h1>WordPress Site Profiles</h1>
      <table>
        <thead>
          <tr>
            <th>Name</th>
            <th>URL</th>
            <th>Status</th>
          </tr>
        </thead>
        <tbody>
          ${profiles.map(p => {
            const status = [];
            if (p.id === currentProfile?.id) {
              status.push('Current');
            }
            if (p.isDefault) {
              status.push('Default');
            }
            
            return `<tr>
              <td>${p.name}</td>
              <td>${p.apiUrl}</td>
              <td>${status.join(', ') || '-'}</td>
            </tr>`;
          }).join('')}
        </tbody>
      </table>
    </body>
    </html>
  `;
}
