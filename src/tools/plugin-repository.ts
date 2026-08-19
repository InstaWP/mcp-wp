// src/tools/plugin-repository.ts
import { Tool } from '@modelcontextprotocol/sdk/types.js';
import { userAgentHeader } from '../config/user-agent.js';
import { searchWordPressPluginRepository } from '../wordpress.js';
import { z } from 'zod';
import { zodToJsonSchema } from 'zod-to-json-schema';

// Define the schema for plugin repository search
const searchPluginRepositorySchema = z.object({
  search: z.string().describe("Search query for WordPress.org plugin repository"),
  page: z.number().min(1).optional().default(1).describe("Page number (1-based)"),
  per_page: z.number().min(1).max(100).optional().default(10).describe("Number of results per page (max 100)")
}).strict();

// Define the schema for getting plugin details
const getPluginDetailsSchema = z.object({
  slug: z.string().describe("Plugin slug from WordPress.org repository")
}).strict();

type SearchPluginRepositoryParams = z.infer<typeof searchPluginRepositorySchema>;
type GetPluginDetailsParams = z.infer<typeof getPluginDetailsSchema>;

// Define the plugin repository tools
export const pluginRepositoryTools: Tool[] = [
  {
    name: "search_plugin_repository",
    description: "Search for plugins in the WordPress.org plugin repository",
    inputSchema: { type: "object", properties: searchPluginRepositorySchema.shape }
  },
  {
    name: "get_plugin_details",
    description: "Get detailed information about a plugin from the WordPress.org repository",
    inputSchema: { type: "object", properties: getPluginDetailsSchema.shape }
  }
];

// Define handlers for plugin repository operations
export const pluginRepositoryHandlers = {
  search_plugin_repository: async (params: SearchPluginRepositoryParams) => {
    try {
      const response = await searchWordPressPluginRepository(
        params.search,
        params.page,
        params.per_page
      );
      
      // Format the response to be more user-friendly
      const formattedPlugins = response.plugins.map((plugin: any) => ({
        name: plugin.name,
        slug: plugin.slug,
        version: plugin.version,
        author: plugin.author,
        requires_wp: plugin.requires,
        tested: plugin.tested,
        rating: plugin.rating,
        active_installs: plugin.active_installs,
        downloaded: plugin.downloaded,
        last_updated: plugin.last_updated,
        short_description: plugin.short_description,
        download_link: plugin.download_link,
        homepage: plugin.homepage
      }));
      
      const result = {
        info: {
          page: response.info.page,
          pages: response.info.pages,
          results: response.info.results
        },
        plugins: formattedPlugins
      };
      
      return {
        toolResult: {
          content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
        },
      };
    } catch (error: any) {
      const errorMessage = error.response?.data?.message || error.message;
      return {
        toolResult: {
          isError: true,
          content: [{ type: 'text', text: `Error searching plugin repository: ${errorMessage}` }],
        },
      };
    }
  },
  
  get_plugin_details: async (params: GetPluginDetailsParams) => {
    try {
      // For plugin details, we use a different action in the WordPress.org API
      const apiUrl = 'https://api.wordpress.org/plugins/info/1.2/';
      const requestData = {
        action: 'plugin_information',
        request: {
          slug: params.slug,
          fields: {
            description: true,
            sections: true,
            tested: true,
            requires: true,
            rating: true,
            ratings: true,
            downloaded: true,
            downloadlink: true,
            last_updated: true,
            homepage: true,
            tags: true,
            compatibility: true,
            author: true,
            contributors: true,
            banners: true,
            icons: true
          }
        }
      };
      
      // Use axios directly for this specific request
      const axios = (await import('axios')).default;
      const response = await axios.post(apiUrl, requestData, {
        headers: {
          'Content-Type': 'application/json',
          ...userAgentHeader()
        }
      });
      
      // Format the plugin details
      const plugin = response.data;
      const formattedPlugin = {
        name: plugin.name,
        slug: plugin.slug,
        version: plugin.version,
        author: plugin.author,
        author_profile: plugin.author_profile,
        contributors: plugin.contributors,
        requires_wp: plugin.requires,
        tested: plugin.tested,
        requires_php: plugin.requires_php,
        rating: plugin.rating,
        ratings: plugin.ratings,
        active_installs: plugin.active_installs,
        downloaded: plugin.downloaded,
        last_updated: plugin.last_updated,
        added: plugin.added,
        homepage: plugin.homepage,
        description: plugin.description,
        short_description: plugin.short_description,
        download_link: plugin.download_link,
        tags: plugin.tags,
        sections: plugin.sections,
        banners: plugin.banners,
        icons: plugin.icons
      };
      
      return {
        toolResult: {
          content: [{ type: 'text', text: JSON.stringify(formattedPlugin, null, 2) }],
        },
      };
    } catch (error: any) {
      const errorMessage = error.response?.data?.message || error.message;
      return {
        toolResult: {
          isError: true,
          content: [{ type: 'text', text: `Error getting plugin details: ${errorMessage}` }],
        },
      };
    }
  }
};
