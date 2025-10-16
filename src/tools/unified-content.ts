// src/tools/unified-content.ts
import { Tool } from '@modelcontextprotocol/sdk/types.js';
import { makeWordPressRequest, logToFile } from '../wordpress.js';
import { z } from 'zod';

// Cache for post types to reduce API calls
let postTypesCache: any = null;
let cacheTimestamp: number = 0;
const CACHE_DURATION = 5 * 60 * 1000; // 5 minutes

// Helper function to get all post types with caching
async function getPostTypes(forceRefresh = false, siteId?: string) {
  const now = Date.now();
  
  if (!forceRefresh && postTypesCache && (now - cacheTimestamp) < CACHE_DURATION) {
    logToFile('Using cached post types');
    return postTypesCache;
  }

  try {
    logToFile('Fetching post types from API');
    const response = await makeWordPressRequest('GET', 'types', undefined, { siteId });
    postTypesCache = response;
    cacheTimestamp = now;
    return response;
  } catch (error: any) {
    logToFile(`Error fetching post types: ${error.message}`);
    throw error;
  }
}

// Helper function to get the correct endpoint for a content type
function getContentEndpoint(contentType: string): string {
  const endpointMap: Record<string, string> = {
    'post': 'posts',
    'page': 'pages'
  };
  
  return endpointMap[contentType] || contentType;
}

// Helper function to parse URL and extract slug and potential post type hints
function parseUrl(url: string): { slug: string; pathHints: string[] } {
  try {
    const urlObj = new URL(url);
    const pathname = urlObj.pathname;
    
    // Remove trailing slash and split path
    const pathParts = pathname.replace(/\/$/, '').split('/').filter(Boolean);
    
    // The slug is typically the last part of the URL
    const slug = pathParts[pathParts.length - 1] || '';
    
    // Path hints can help identify the post type
    const pathHints = pathParts.slice(0, -1);
    
    return { slug, pathHints };
  } catch (error) {
    logToFile(`Error parsing URL ${url}: ${error}`);
    return { slug: '', pathHints: [] };
  }
}

// Helper function to find content across multiple post types
async function findContentAcrossTypes(slug: string, contentTypes?: string[], siteId?: string) {
  const typesToSearch = contentTypes || [];
  
  // If no specific content types provided, get all available types
  if (typesToSearch.length === 0) {
    const allTypes = await getPostTypes(false, siteId);
    typesToSearch.push(...Object.keys(allTypes).filter(type => 
      type !== 'attachment' && type !== 'wp_block'
    ));
  }
  
  logToFile(`Searching for slug "${slug}" across content types: ${typesToSearch.join(', ')}`);
  
  // Search each content type for the slug
  for (const contentType of typesToSearch) {
    try {
      const endpoint = getContentEndpoint(contentType);
      
      const response = await makeWordPressRequest('GET', endpoint, {
        slug: slug,
        per_page: 1
      }, { siteId });
      
      if (Array.isArray(response) && response.length > 0) {
        logToFile(`Found content with slug "${slug}" in content type "${contentType}"`);
        return { content: response[0], contentType };
      }
    } catch (error) {
      logToFile(`Error searching ${contentType}: ${error}`);
    }
  }
  
  return null;
}

// Schema definitions
const listContentSchema = z.object({
  content_type: z.string().describe("The content type slug (e.g., 'post', 'page', 'product', 'documentation')"),
  site_id: z.string().optional().describe("Site ID (for multi-site setups)"),
  page: z.number().optional().describe("Page number (default 1)"),
  per_page: z.number().min(1).max(100).optional().describe("Items per page (default 10, max 100)"),
  search: z.string().optional().describe("Search term for content title or body"),
  slug: z.string().optional().describe("Limit result to content with a specific slug"),
  status: z.string().optional().describe("Content status (publish, draft, etc.)"),
  author: z.union([z.number(), z.array(z.number())]).optional().describe("Author ID or array of IDs"),
  categories: z.union([z.number(), z.array(z.number())]).optional().describe("Category ID or array of IDs (for posts)"),
  tags: z.union([z.number(), z.array(z.number())]).optional().describe("Tag ID or array of IDs (for posts)"),
  parent: z.number().optional().describe("Parent ID (for hierarchical content like pages)"),
  orderby: z.string().optional().describe("Sort content by parameter"),
  order: z.enum(['asc', 'desc']).optional().describe("Order sort attribute"),
  after: z.string().optional().describe("ISO8601 date string to get content published after this date"),
  before: z.string().optional().describe("ISO8601 date string to get content published before this date")
});

const getContentSchema = z.object({
  content_type: z.string().describe("The content type slug"),
  id: z.number().describe("Content ID"),
  site_id: z.string().optional().describe("Site ID (for multi-site setups)")
});

const createContentSchema = z.object({
  content_type: z.string().describe("The content type slug"),
  site_id: z.string().optional().describe("Site ID (for multi-site setups)"),
  title: z.string().describe("Content title"),
  content: z.string().describe("Content body"),
  status: z.string().optional().default('draft').describe("Content status"),
  excerpt: z.string().optional().describe("Content excerpt"),
  slug: z.string().optional().describe("Content slug"),
  author: z.number().optional().describe("Author ID"),
  parent: z.number().optional().describe("Parent ID (for hierarchical content)"),
  categories: z.array(z.number()).optional().describe("Array of category IDs (for posts)"),
  tags: z.array(z.number()).optional().describe("Array of tag IDs (for posts)"),
  featured_media: z.number().optional().describe("Featured image ID"),
  format: z.string().optional().describe("Content format"),
  menu_order: z.number().optional().describe("Menu order (for pages)"),
  meta: z.record(z.any()).optional().describe("Meta fields"),
  custom_fields: z.record(z.any()).optional().describe("Custom fields specific to this content type")
});

const updateContentSchema = z.object({
  content_type: z.string().describe("The content type slug"),
  id: z.number().describe("Content ID"),
  site_id: z.string().optional().describe("Site ID (for multi-site setups)"),
  title: z.string().optional().describe("Content title"),
  content: z.string().optional().describe("Content body"),
  status: z.string().optional().describe("Content status"),
  excerpt: z.string().optional().describe("Content excerpt"),
  slug: z.string().optional().describe("Content slug"),
  author: z.number().optional().describe("Author ID"),
  parent: z.number().optional().describe("Parent ID"),
  categories: z.array(z.number()).optional().describe("Array of category IDs"),
  tags: z.array(z.number()).optional().describe("Array of tag IDs"),
  featured_media: z.number().optional().describe("Featured image ID"),
  format: z.string().optional().describe("Content format"),
  menu_order: z.number().optional().describe("Menu order"),
  meta: z.record(z.any()).optional().describe("Meta fields"),
  custom_fields: z.record(z.any()).optional().describe("Custom fields")
});

const deleteContentSchema = z.object({
  content_type: z.string().describe("The content type slug"),
  id: z.number().describe("Content ID"),
  site_id: z.string().optional().describe("Site ID (for multi-site setups)"),
  force: z.boolean().optional().describe("Whether to bypass trash and force deletion")
});

const discoverContentTypesSchema = z.object({
  refresh_cache: z.boolean().optional().describe("Force refresh the content types cache"),
  site_id: z.string().optional().describe("Site ID (for multi-site setups)")
});

const findContentByUrlSchema = z.object({
  url: z.string().describe("The full URL of the content to find"),
  site_id: z.string().optional().describe("Site ID (for multi-site setups)"),
  update_fields: z.object({
    title: z.string().optional(),
    content: z.string().optional(),
    status: z.string().optional(),
    meta: z.record(z.any()).optional(),
    custom_fields: z.record(z.any()).optional()
  }).optional().describe("Optional fields to update after finding the content")
});

const getContentBySlugSchema = z.object({
  slug: z.string().describe("The slug to search for"),
  site_id: z.string().optional().describe("Site ID (for multi-site setups)"),
  content_types: z.array(z.string()).optional().describe("Content types to search in (defaults to all)")
});

// Type definitions
type ListContentParams = z.infer<typeof listContentSchema>;
type GetContentParams = z.infer<typeof getContentSchema>;
type CreateContentParams = z.infer<typeof createContentSchema>;
type UpdateContentParams = z.infer<typeof updateContentSchema>;
type DeleteContentParams = z.infer<typeof deleteContentSchema>;
type DiscoverContentTypesParams = z.infer<typeof discoverContentTypesSchema>;
type FindContentByUrlParams = z.infer<typeof findContentByUrlSchema>;
type GetContentBySlugParams = z.infer<typeof getContentBySlugSchema>;

export const unifiedContentTools: Tool[] = [
  {
    name: "list_content",
    description: "Lists content of any type (posts, pages, or custom post types) with filtering and pagination",
    inputSchema: { type: "object", properties: listContentSchema.shape }
  },
  {
    name: "get_content",
    description: "Gets specific content by ID and content type",
    inputSchema: { type: "object", properties: getContentSchema.shape }
  },
  {
    name: "create_content",
    description: "Creates new content of any type",
    inputSchema: { type: "object", properties: createContentSchema.shape }
  },
  {
    name: "update_content",
    description: "Updates existing content of any type",
    inputSchema: { type: "object", properties: updateContentSchema.shape }
  },
  {
    name: "delete_content",
    description: "Deletes content of any type",
    inputSchema: { type: "object", properties: deleteContentSchema.shape }
  },
  {
    name: "discover_content_types",
    description: "Discovers all available content types (built-in and custom) in the WordPress site",
    inputSchema: { type: "object", properties: discoverContentTypesSchema.shape }
  },
  {
    name: "find_content_by_url", 
    description: "Finds content by its URL, automatically detecting the content type, and optionally updates it",
    inputSchema: { type: "object", properties: findContentByUrlSchema.shape }
  },
  {
    name: "get_content_by_slug",
    description: "Searches for content by slug across one or more content types",
    inputSchema: { type: "object", properties: getContentBySlugSchema.shape }
  }
];

export const unifiedContentHandlers = {
  list_content: async (params: ListContentParams) => {
    try {
      const endpoint = getContentEndpoint(params.content_type);
      const { content_type, site_id, ...queryParams } = params;
      
      const response = await makeWordPressRequest('GET', endpoint, queryParams, { siteId: site_id });
      
      return {
        toolResult: {
          content: [{ 
            type: 'text', 
            text: JSON.stringify(response, null, 2) 
          }],
          isError: false
        }
      };
    } catch (error: any) {
      return {
        toolResult: {
          content: [{ 
            type: 'text', 
            text: `Error listing content: ${error.message}` 
          }],
          isError: true
        }
      };
    }
  },

  get_content: async (params: GetContentParams) => {
    try {
      const endpoint = getContentEndpoint(params.content_type);
      const response = await makeWordPressRequest('GET', `${endpoint}/${params.id}`, undefined, { siteId: params.site_id });
      
      return {
        toolResult: {
          content: [{ 
            type: 'text', 
            text: JSON.stringify(response, null, 2) 
          }],
          isError: false
        }
      };
    } catch (error: any) {
      return {
        toolResult: {
          content: [{ 
            type: 'text', 
            text: `Error getting content: ${error.message}` 
          }],
          isError: true
        }
      };
    }
  },

  create_content: async (params: CreateContentParams) => {
    try {
      const endpoint = getContentEndpoint(params.content_type);
      
      const contentData: any = {
        title: params.title,
        content: params.content,
        status: params.status,
        excerpt: params.excerpt,
        slug: params.slug,
        author: params.author,
        parent: params.parent,
        featured_media: params.featured_media,
        format: params.format,
        menu_order: params.menu_order
      };
      
      // Add post-specific fields
      if (params.categories) contentData.categories = params.categories;
      if (params.tags) contentData.tags = params.tags;
      
      // Add meta fields
      if (params.meta) contentData.meta = params.meta;
      
      // Add custom fields
      if (params.custom_fields) {
        Object.assign(contentData, params.custom_fields);
      }
      
      // Remove undefined values
      Object.keys(contentData).forEach(key => {
        if (contentData[key] === undefined) {
          delete contentData[key];
        }
      });
      
      const response = await makeWordPressRequest('POST', endpoint, contentData, { siteId: params.site_id });
      
      return {
        toolResult: {
          content: [{ 
            type: 'text', 
            text: JSON.stringify(response, null, 2) 
          }],
          isError: false
        }
      };
    } catch (error: any) {
      return {
        toolResult: {
          content: [{ 
            type: 'text', 
            text: `Error creating content: ${error.message}` 
          }],
          isError: true
        }
      };
    }
  },

  update_content: async (params: UpdateContentParams) => {
    try {
      const endpoint = getContentEndpoint(params.content_type);
      
      const updateData: any = {};
      
      // Only include defined fields
      if (params.title !== undefined) updateData.title = params.title;
      if (params.content !== undefined) updateData.content = params.content;
      if (params.status !== undefined) updateData.status = params.status;
      if (params.excerpt !== undefined) updateData.excerpt = params.excerpt;
      if (params.slug !== undefined) updateData.slug = params.slug;
      if (params.author !== undefined) updateData.author = params.author;
      if (params.parent !== undefined) updateData.parent = params.parent;
      if (params.featured_media !== undefined) updateData.featured_media = params.featured_media;
      if (params.format !== undefined) updateData.format = params.format;
      if (params.menu_order !== undefined) updateData.menu_order = params.menu_order;
      if (params.categories !== undefined) updateData.categories = params.categories;
      if (params.tags !== undefined) updateData.tags = params.tags;
      if (params.meta !== undefined) updateData.meta = params.meta;
      
      // Add custom fields
      if (params.custom_fields) {
        Object.assign(updateData, params.custom_fields);
      }
      
      const response = await makeWordPressRequest('POST', `${endpoint}/${params.id}`, updateData, { siteId: params.site_id });
      
      return {
        toolResult: {
          content: [{ 
            type: 'text', 
            text: JSON.stringify(response, null, 2) 
          }],
          isError: false
        }
      };
    } catch (error: any) {
      return {
        toolResult: {
          content: [{ 
            type: 'text', 
            text: `Error updating content: ${error.message}` 
          }],
          isError: true
        }
      };
    }
  },

  delete_content: async (params: DeleteContentParams) => {
    try {
      const endpoint = getContentEndpoint(params.content_type);
      
      const response = await makeWordPressRequest('DELETE', `${endpoint}/${params.id}`, {
        force: params.force || false
      }, { siteId: params.site_id });
      
      return {
        toolResult: {
          content: [{ 
            type: 'text', 
            text: JSON.stringify(response, null, 2) 
          }],
          isError: false
        }
      };
    } catch (error: any) {
      return {
        toolResult: {
          content: [{ 
            type: 'text', 
            text: `Error deleting content: ${error.message}` 
          }],
          isError: true
        }
      };
    }
  },

  discover_content_types: async (params: DiscoverContentTypesParams) => {
    try {
      const contentTypes = await getPostTypes(params.refresh_cache || false, params.site_id);
      
      // Format the response to be more readable
      const formattedTypes = Object.entries(contentTypes).map(([slug, type]: [string, any]) => ({
        slug,
        name: type.name,
        description: type.description,
        rest_base: type.rest_base,
        hierarchical: type.hierarchical,
        supports: type.supports,
        taxonomies: type.taxonomies
      }));
      
      return {
        toolResult: {
          content: [{ 
            type: 'text', 
            text: JSON.stringify(formattedTypes, null, 2) 
          }],
          isError: false
        }
      };
    } catch (error: any) {
      return {
        toolResult: {
          content: [{ 
            type: 'text', 
            text: `Error discovering content types: ${error.message}` 
          }],
          isError: true
        }
      };
    }
  },

  find_content_by_url: async (params: FindContentByUrlParams) => {
    try {
      const { slug, pathHints } = parseUrl(params.url);
      
      if (!slug) {
        throw new Error('Could not extract slug from URL');
      }
      
      logToFile(`Searching for content with slug: ${slug}, path hints: ${pathHints.join('/')}`);
      
      // Try to guess content types based on URL structure
      const priorityTypes: string[] = [];
      
      // Common URL patterns to content type mappings
      const pathMappings: Record<string, string[]> = {
        'documentation': ['documentation', 'docs', 'doc'],
        'docs': ['documentation', 'docs', 'doc'],
        'products': ['product'],
        'portfolio': ['portfolio', 'project'],
        'services': ['service'],
        'testimonials': ['testimonial'],
        'team': ['team_member', 'staff'],
        'events': ['event'],
        'courses': ['course', 'lesson']
      };
      
      // Check path hints for potential content types
      for (const hint of pathHints) {
        const mappedTypes = pathMappings[hint.toLowerCase()];
        if (mappedTypes) {
          priorityTypes.push(...mappedTypes);
        }
      }
      
      // Always check standard content types as fallback
      priorityTypes.push('post', 'page');
      
      // Remove duplicates
      const typesToSearch = [...new Set(priorityTypes)];
      
      // Find the content
      const result = await findContentAcrossTypes(slug, typesToSearch, params.site_id);
      
      if (!result) {
        // If not found in priority types, search all types
        const allResult = await findContentAcrossTypes(slug, undefined, params.site_id);
        if (!allResult) {
          throw new Error(`No content found with URL: ${params.url}`);
        }
        
        const { content, contentType } = allResult;
        
        // Update if requested
        if (params.update_fields) {
          const endpoint = getContentEndpoint(contentType);
          
          const updateData: any = {};
          if (params.update_fields.title !== undefined) updateData.title = params.update_fields.title;
          if (params.update_fields.content !== undefined) updateData.content = params.update_fields.content;
          if (params.update_fields.status !== undefined) updateData.status = params.update_fields.status;
          if (params.update_fields.meta !== undefined) updateData.meta = params.update_fields.meta;
          if (params.update_fields.custom_fields !== undefined) {
            Object.assign(updateData, params.update_fields.custom_fields);
          }
          
          const updatedContent = await makeWordPressRequest('POST', `${endpoint}/${content.id}`, updateData, { siteId: params.site_id });
          
          return {
            toolResult: {
              content: [{ 
                type: 'text', 
                text: JSON.stringify({
                  found: true,
                  content_type: contentType,
                  content_id: content.id,
                  original_url: params.url,
                  updated: true,
                  content: updatedContent
                }, null, 2)
              }],
              isError: false
            }
          };
        }
        
        return {
          toolResult: {
            content: [{ 
              type: 'text', 
              text: JSON.stringify({
                found: true,
                content_type: contentType,
                content_id: content.id,
                original_url: params.url,
                content: content
              }, null, 2)
            }],
            isError: false
          }
        };
      }
      
      const { content, contentType } = result;
      
      // Update if requested
      if (params.update_fields) {
        const endpoint = getContentEndpoint(contentType);
        
        const updateData: any = {};
        if (params.update_fields.title !== undefined) updateData.title = params.update_fields.title;
        if (params.update_fields.content !== undefined) updateData.content = params.update_fields.content;
        if (params.update_fields.status !== undefined) updateData.status = params.update_fields.status;
        if (params.update_fields.meta !== undefined) updateData.meta = params.update_fields.meta;
        if (params.update_fields.custom_fields !== undefined) {
          Object.assign(updateData, params.update_fields.custom_fields);
        }
        
        const updatedContent = await makeWordPressRequest('POST', `${endpoint}/${content.id}`, updateData, { siteId: params.site_id });
        
        return {
          toolResult: {
            content: [{ 
              type: 'text', 
              text: JSON.stringify({
                found: true,
                content_type: contentType,
                content_id: content.id,
                original_url: params.url,
                updated: true,
                content: updatedContent
              }, null, 2)
            }],
            isError: false
          }
        };
      }
      
      return {
        toolResult: {
          content: [{ 
            type: 'text', 
            text: JSON.stringify({
              found: true,
              content_type: contentType,
              content_id: content.id,
              original_url: params.url,
              content: content
            }, null, 2)
          }],
          isError: false
        }
      };
    } catch (error: any) {
      return {
        toolResult: {
          content: [{ 
            type: 'text', 
            text: `Error finding content by URL: ${error.message}` 
          }],
          isError: true
        }
      };
    }
  },

  get_content_by_slug: async (params: GetContentBySlugParams) => {
    try {
      const result = await findContentAcrossTypes(params.slug, params.content_types, params.site_id);
      
      if (!result) {
        throw new Error(`No content found with slug: ${params.slug}`);
      }
      
      return {
        toolResult: {
          content: [{ 
            type: 'text', 
            text: JSON.stringify({
              found: true,
              content_type: result.contentType,
              content: result.content
            }, null, 2)
          }],
          isError: false
        }
      };
    } catch (error: any) {
      return {
        toolResult: {
          content: [{ 
            type: 'text', 
            text: `Error getting content by slug: ${error.message}` 
          }],
          isError: true
        }
      };
    }
  }
};