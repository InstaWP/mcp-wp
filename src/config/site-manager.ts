import axios, { AxiosInstance } from 'axios';
import { logToFile } from '../wordpress.js';

export interface SiteConfig {
  id: string;
  url: string;
  username: string;
  password: string;
  aliases?: string[];
  default?: boolean;
}

export class SiteManager {
  private sites = new Map<string, SiteConfig>();
  private clients = new Map<string, AxiosInstance>();
  private defaultSiteId: string | null = null;
  private initialized = false;

  constructor() {
    // Don't load sites immediately - wait for first access
  }

  /**
   * Ensure sites are loaded (lazy initialization)
   */
  private ensureInitialized() {
    if (!this.initialized) {
      this.loadSitesFromEnvironment();
      this.initialized = true;
    }
  }

  /**
   * Load site configurations from environment variables
   */
  private loadSitesFromEnvironment() {
    let sitesFound = 0;

    // Check for numbered multi-site configuration (WORDPRESS_1_URL, WORDPRESS_2_URL, etc.)
    for (let i = 1; i <= 10; i++) { // Support up to 10 sites
      const urlKey = `WORDPRESS_${i}_URL`;
      const usernameKey = `WORDPRESS_${i}_USERNAME`;
      const passwordKey = `WORDPRESS_${i}_PASSWORD`;
      const idKey = `WORDPRESS_${i}_ID`;
      const aliasesKey = `WORDPRESS_${i}_ALIASES`;
      const defaultKey = `WORDPRESS_${i}_DEFAULT`;

      if (process.env[urlKey] && process.env[usernameKey] && process.env[passwordKey]) {
        const siteConfig: SiteConfig = {
          id: process.env[idKey] || `site${i}`,
          url: process.env[urlKey]!,
          username: process.env[usernameKey]!,
          password: process.env[passwordKey]!,
          aliases: process.env[aliasesKey] ? process.env[aliasesKey]!.split(',').map(s => s.trim()) : undefined,
          default: process.env[defaultKey] === 'true' || (sitesFound === 0 && i === 1) // First site is default unless explicitly set
        };

        this.sites.set(siteConfig.id, siteConfig);
        if (siteConfig.default) {
          this.defaultSiteId = siteConfig.id;
        }
        sitesFound++;
      }
    }

    // If no numbered sites found, fall back to single-site configuration
    if (sitesFound === 0 && process.env.WORDPRESS_API_URL && process.env.WORDPRESS_USERNAME && process.env.WORDPRESS_PASSWORD) {
      const siteConfig: SiteConfig = {
        id: 'default',
        url: process.env.WORDPRESS_API_URL,
        username: process.env.WORDPRESS_USERNAME,
        password: process.env.WORDPRESS_PASSWORD,
        default: true
      };
      this.sites.set('default', siteConfig);
      this.defaultSiteId = 'default';
      sitesFound = 1;
      logToFile('Loaded single site configuration from legacy environment variables');
    }

    if (sitesFound > 0) {
      logToFile(`Loaded ${sitesFound} WordPress site(s) from environment variables`);
      if (this.defaultSiteId) {
        logToFile(`Default site: ${this.defaultSiteId}`);
      }
    } else {
      throw new Error('No WordPress configuration found. Set WORDPRESS_1_URL, WORDPRESS_1_USERNAME, WORDPRESS_1_PASSWORD (and optionally WORDPRESS_2_*, etc.) or use legacy WORDPRESS_API_URL variables.');
    }
  }

  /**
   * Get site configuration by ID
   */
  getSite(siteId?: string): SiteConfig {
    this.ensureInitialized();
    
    const targetSiteId = siteId || this.defaultSiteId;
    if (!targetSiteId) {
      throw new Error('No site specified and no default site configured');
    }

    const site = this.sites.get(targetSiteId);
    if (!site) {
      const availableSites = Array.from(this.sites.keys()).join(', ');
      throw new Error(`Site '${targetSiteId}' not found. Available sites: ${availableSites}`);
    }

    return site;
  }

  /**
   * Get all configured sites
   */
  getAllSites(): SiteConfig[] {
    this.ensureInitialized();
    return Array.from(this.sites.values());
  }

  /**
   * Get default site ID
   */
  getDefaultSiteId(): string | null {
    this.ensureInitialized();
    return this.defaultSiteId;
  }

  /**
   * Detect site from context (domain mentions, aliases, etc.)
   */
  detectSiteFromContext(requestText: string): string | null {
    this.ensureInitialized();
    
    if (!requestText) return null;

    const lowerRequest = requestText.toLowerCase();

    // Check for domain mentions
    for (const site of this.sites.values()) {
      try {
        const hostname = new URL(site.url).hostname;
        if (lowerRequest.includes(hostname)) {
          logToFile(`Detected site '${site.id}' from domain mention: ${hostname}`);
          return site.id;
        }
      } catch (error) {
        // Invalid URL, skip
      }
    }

    // Check for alias mentions
    for (const site of this.sites.values()) {
      if (site.aliases) {
        for (const alias of site.aliases) {
          if (lowerRequest.includes(alias.toLowerCase())) {
            logToFile(`Detected site '${site.id}' from alias mention: ${alias}`);
            return site.id;
          }
        }
      }
    }

    // Check for site ID mentions
    for (const siteId of this.sites.keys()) {
      if (lowerRequest.includes(siteId.toLowerCase())) {
        logToFile(`Detected site '${siteId}' from ID mention`);
        return siteId;
      }
    }

    return null;
  }

  /**
   * Get WordPress client for a specific site
   */
  async getClient(siteId?: string): Promise<AxiosInstance> {
    this.ensureInitialized();
    
    const site = this.getSite(siteId);
    
    if (!this.clients.has(site.id)) {
      const client = await this.createClient(site);
      this.clients.set(site.id, client);
    }

    return this.clients.get(site.id)!;
  }

  /**
   * Create authenticated WordPress client for a site
   */
  private async createClient(site: SiteConfig): Promise<AxiosInstance> {
    // Ensure the API URL has the WordPress REST API path
    let baseURL = site.url.endsWith('/') ? site.url : `${site.url}/`;
    
    if (!baseURL.includes('/wp-json/wp/v2')) {
      baseURL = baseURL + 'wp-json/wp/v2/';
    } else if (!baseURL.endsWith('/')) {
      baseURL = baseURL + '/';
    }

    const auth = Buffer.from(`${site.username}:${site.password}`).toString('base64');
    
    const client = axios.create({
      baseURL,
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Basic ${auth}`
      }
    });

    // Test the connection
    try {
      await client.get('');
      logToFile(`Successfully connected to site '${site.id}' at ${baseURL}`);
    } catch (error: any) {
      logToFile(`Failed to connect to site '${site.id}': ${error.message}`);
      throw new Error(`Failed to connect to site '${site.id}': ${error.message}`);
    }

    return client;
  }

  /**
   * Test connection to a specific site
   */
  async testSite(siteId?: string): Promise<{ success: boolean; error?: string }> {
    this.ensureInitialized();
    
    try {
      const client = await this.getClient(siteId);
      await client.get('');
      return { success: true };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  }
}

// Global site manager instance
export const siteManager = new SiteManager();
