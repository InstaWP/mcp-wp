import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { v4 as uuidv4 } from 'uuid';

/**
 * Interface representing a WordPress site profile
 */
export interface WordPressSiteProfile {
  id: string;
  name: string;
  apiUrl: string;
  username: string;
  password: string;
  isDefault?: boolean;
  lastConnected?: string; // ISO date string
  customSettings?: Record<string, any>;
}

/**
 * Manager for WordPress site profiles
 */
export class SiteProfileManager {
  private context: vscode.ExtensionContext;
  private currentProfileId: string | null = null;
  private static readonly PROFILES_KEY = 'wordpressSiteProfiles';
  private static readonly CURRENT_PROFILE_KEY = 'currentWordPressSiteProfileId';
  
  constructor(context: vscode.ExtensionContext) {
    this.context = context;
    this.currentProfileId = this.context.globalState.get<string>(SiteProfileManager.CURRENT_PROFILE_KEY, null);
  }
  
  /**
   * Get all site profiles
   */
  public getProfiles(): WordPressSiteProfile[] {
    return this.context.globalState.get<WordPressSiteProfile[]>(SiteProfileManager.PROFILES_KEY, []);
  }
  
  /**
   * Add a new site profile
   */
  public async addProfile(profile: Omit<WordPressSiteProfile, 'id'>): Promise<WordPressSiteProfile> {
    const profiles = this.getProfiles();
    
    // Generate a unique ID for the profile
    const newProfile: WordPressSiteProfile = {
      ...profile,
      id: uuidv4(),
      lastConnected: new Date().toISOString()
    };
    
    // If this is the first profile, make it the default
    if (profiles.length === 0) {
      newProfile.isDefault = true;
    }
    
    profiles.push(newProfile);
    await this.context.globalState.update(SiteProfileManager.PROFILES_KEY, profiles);
    
    // If this is the first profile or it's marked as default, set it as current
    if (newProfile.isDefault) {
      await this.switchProfile(newProfile.id);
    }
    
    return newProfile;
  }
  
  /**
   * Update an existing site profile
   */
  public async updateProfile(id: string, updates: Partial<Omit<WordPressSiteProfile, 'id'>>): Promise<boolean> {
    const profiles = this.getProfiles();
    const index = profiles.findIndex(p => p.id === id);
    
    if (index === -1) {
      return false;
    }
    
    profiles[index] = {
      ...profiles[index],
      ...updates
    };
    
    await this.context.globalState.update(SiteProfileManager.PROFILES_KEY, profiles);
    
    // If this is the current profile, update the VS Code settings
    if (this.currentProfileId === id) {
      await this.updateVSCodeSettings(profiles[index]);
    }
    
    return true;
  }
  
  /**
   * Delete a site profile
   */
  public async deleteProfile(id: string): Promise<boolean> {
    const profiles = this.getProfiles();
    const index = profiles.findIndex(p => p.id === id);
    
    if (index === -1) {
      return false;
    }
    
    const wasDefault = profiles[index].isDefault;
    profiles.splice(index, 1);
    
    // If we deleted the default profile, set a new default if possible
    if (wasDefault && profiles.length > 0) {
      profiles[0].isDefault = true;
    }
    
    await this.context.globalState.update(SiteProfileManager.PROFILES_KEY, profiles);
    
    // If we deleted the current profile, switch to the new default or clear current
    if (this.currentProfileId === id) {
      if (profiles.length > 0) {
        const newDefault = profiles.find(p => p.isDefault) || profiles[0];
        await this.switchProfile(newDefault.id);
      } else {
        this.currentProfileId = null;
        await this.context.globalState.update(SiteProfileManager.CURRENT_PROFILE_KEY, null);
        await this.clearVSCodeSettings();
      }
    }
    
    return true;
  }
  
  /**
   * Get the current site profile
   */
  public getCurrentProfile(): WordPressSiteProfile | null {
    if (!this.currentProfileId) {
      return null;
    }
    
    const profiles = this.getProfiles();
    return profiles.find(p => p.id === this.currentProfileId) || null;
  }
  
  /**
   * Switch to a different site profile
   */
  public async switchProfile(profileId: string): Promise<boolean> {
    const profiles = this.getProfiles();
    const profile = profiles.find(p => p.id === profileId);
    
    if (!profile) {
      return false;
    }
    
    this.currentProfileId = profileId;
    await this.context.globalState.update(SiteProfileManager.CURRENT_PROFILE_KEY, profileId);
    
    // Update the profile's last connected timestamp
    await this.updateProfile(profileId, {
      lastConnected: new Date().toISOString()
    });
    
    // Update VS Code settings for this profile
    await this.updateVSCodeSettings(profile);
    
    // Update MCP configuration for this profile
    await this.updateMcpConfig(profile);
    
    return true;
  }
  
  /**
   * Update VS Code settings for a profile
   */
  private async updateVSCodeSettings(profile: WordPressSiteProfile): Promise<void> {
    const config = vscode.workspace.getConfiguration('wordpress-mcp');
    
    await config.update('apiUrl', profile.apiUrl, vscode.ConfigurationTarget.Global);
    await config.update('username', profile.username, vscode.ConfigurationTarget.Global);
    await config.update('password', profile.password, vscode.ConfigurationTarget.Global);
    await config.update('siteName', profile.name, vscode.ConfigurationTarget.Global);
  }
  
  /**
   * Clear VS Code settings
   */
  private async clearVSCodeSettings(): Promise<void> {
    const config = vscode.workspace.getConfiguration('wordpress-mcp');
    
    await config.update('apiUrl', '', vscode.ConfigurationTarget.Global);
    await config.update('username', '', vscode.ConfigurationTarget.Global);
    await config.update('password', '', vscode.ConfigurationTarget.Global);
    await config.update('siteName', 'WordPress', vscode.ConfigurationTarget.Global);
  }
  
  /**
   * Update MCP configuration for a profile
   */
  private async updateMcpConfig(profile: WordPressSiteProfile): Promise<void> {
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
          "default": profile.apiUrl
        },
        {
          "type": "promptString",
          "id": "wordpress-username",
          "description": "WordPress Username",
          "default": profile.username
        },
        {
          "type": "promptString",
          "id": "wordpress-password",
          "description": "WordPress Application Password",
          "password": true,
          "default": profile.password
        }
      ],
      "servers": {
        [`WordPress MCP - ${profile.name}`]: {
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
