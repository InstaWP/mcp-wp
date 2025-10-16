// src/tools/site-management.ts
import { z } from 'zod';
import { Tool } from '@modelcontextprotocol/sdk/types.js';
import { siteManager } from '../config/site-manager.js';

// Schemas
const listSitesSchema = z.object({});

const getSiteSchema = z.object({
  site_id: z.string().optional().describe('Site ID to get details for. If not provided, returns the default site.')
});

const testSiteSchema = z.object({
  site_id: z.string().optional().describe('Site ID to test connection. If not provided, tests the default site.')
});

// Tools
export const siteManagementTools: Tool[] = [
  {
    name: 'list_sites',
    description: 'List all configured WordPress sites. Shows site IDs, URLs, and which is the default.',
    inputSchema: {
      type: 'object',
      properties: listSitesSchema.shape,
      required: []
    }
  },
  {
    name: 'get_site',
    description: 'Get details about a specific WordPress site configuration.',
    inputSchema: {
      type: 'object',
      properties: getSiteSchema.shape,
      required: []
    }
  },
  {
    name: 'test_site',
    description: 'Test the connection to a specific WordPress site.',
    inputSchema: {
      type: 'object',
      properties: testSiteSchema.shape,
      required: []
    }
  }
];

// Handlers
export const siteManagementHandlers = {
  list_sites: async (params: z.infer<typeof listSitesSchema>) => {
    try {
      const sites = siteManager.getAllSites();
      const defaultSiteId = siteManager.getDefaultSiteId();

      const sitesList = sites.map(site => ({
        id: site.id,
        url: site.url,
        username: site.username,
        aliases: site.aliases || [],
        isDefault: site.id === defaultSiteId
      }));

      return {
        toolResult: {
          content: [{
            type: 'text' as const,
            text: JSON.stringify({
              sites: sitesList,
              count: sites.length,
              default_site: defaultSiteId
            }, null, 2)
          }]
        }
      };
    } catch (error: any) {
      return {
        toolResult: {
          content: [{
            type: 'text' as const,
            text: `Error listing sites: ${error.message}`
          }],
          isError: true
        }
      };
    }
  },

  get_site: async (params: z.infer<typeof getSiteSchema>) => {
    try {
      const site = siteManager.getSite(params.site_id);
      
      return {
        toolResult: {
          content: [{
            type: 'text' as const,
            text: JSON.stringify({
              id: site.id,
              url: site.url,
              username: site.username,
              aliases: site.aliases || [],
              isDefault: site.id === siteManager.getDefaultSiteId()
            }, null, 2)
          }]
        }
      };
    } catch (error: any) {
      return {
        toolResult: {
          content: [{
            type: 'text' as const,
            text: `Error getting site: ${error.message}`
          }],
          isError: true
        }
      };
    }
  },

  test_site: async (params: z.infer<typeof testSiteSchema>) => {
    try {
      const result = await siteManager.testSite(params.site_id);
      const site = siteManager.getSite(params.site_id);
      
      return {
        toolResult: {
          content: [{
            type: 'text' as const,
            text: JSON.stringify({
              site_id: site.id,
              site_url: site.url,
              success: result.success,
              error: result.error || null,
              message: result.success 
                ? `Successfully connected to ${site.url}`
                : `Failed to connect to ${site.url}: ${result.error}`
            }, null, 2)
          }],
          isError: !result.success
        }
      };
    } catch (error: any) {
      return {
        toolResult: {
          content: [{
            type: 'text' as const,
            text: `Error testing site: ${error.message}`
          }],
          isError: true
        }
      };
    }
  }
};
