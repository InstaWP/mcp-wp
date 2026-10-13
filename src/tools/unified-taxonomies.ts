// src/tools/unified-taxonomies.ts
import { Tool } from '@modelcontextprotocol/sdk/types.js';
import { makeWordPressRequest, logToFile } from '../wordpress.js';
import { getContentEndpoint, resolveCacheSiteId } from './unified-content.js';
import { z } from 'zod';

// Cache for taxonomies, keyed per site, to reduce API calls
interface TaxonomyCacheEntry {
  data: any;
  timestamp: number;
}
const taxonomiesCache = new Map<string, TaxonomyCacheEntry>();
const CACHE_DURATION = 5 * 60 * 1000; // 5 minutes

// Helper function to get all taxonomies for a site with caching
async function getTaxonomies(forceRefresh = false, siteId?: string) {
  const cacheKey = resolveCacheSiteId(siteId);
  const now = Date.now();
  const cached = taxonomiesCache.get(cacheKey);

  if (!forceRefresh && cached && (now - cached.timestamp) < CACHE_DURATION) {
    logToFile('Using cached taxonomies');
    return cached.data;
  }

  try {
    logToFile('Fetching taxonomies from API');
    const response = await makeWordPressRequest('GET', 'taxonomies', undefined, { siteId });
    taxonomiesCache.set(cacheKey, { data: response, timestamp: now });
    return response;
  } catch (error: any) {
    logToFile(`Error fetching taxonomies: ${error.message}`);
    throw error;
  }
}

/**
 * Resolve a taxonomy identifier (slug or rest_base) to its canonical slug and
 * rest_base via the site's /wp/v2/taxonomies response.
 *
 * WordPress only guarantees rest_base === slug for built-ins; any
 * register_taxonomy() call can set a different rest_base (e.g. slug
 * "documentation_category" with rest_base "documentation-categories").
 * The REST field name on post objects and the term endpoint both use
 * rest_base, so every code path must route through this resolver.
 *
 * Hard-errors on unknown taxonomies: a silent slug fallback is what
 * previously let writes report success while writing nothing.
 */
async function resolveTaxonomy(input: string, siteId?: string): Promise<{ slug: string; restBase: string }> {
  const findIn = (taxonomies: any) => {
    for (const [slug, info] of Object.entries<any>(taxonomies)) {
      if (slug === input || info.rest_base === input) {
        return { slug, restBase: info.rest_base || slug };
      }
    }
    return null;
  };

  let match = findIn(await getTaxonomies(false, siteId));
  if (match) return match;

  // Refresh once in case the taxonomy was registered after the cache was filled
  const fresh = await getTaxonomies(true, siteId);
  match = findIn(fresh);
  if (match) return match;

  const available = Object.entries<any>(fresh)
    .map(([slug, info]) => (info.rest_base && info.rest_base !== slug ? `${slug} (rest_base: ${info.rest_base})` : slug))
    .join(', ');
  throw new Error(`Unknown taxonomy "${input}" — not found in /wp/v2/taxonomies. Available: ${available}`);
}

// Schema definitions
const siteIdSchema = z.string().optional().describe("Site ID (for multi-site setups). Uses the default site if omitted.");

const discoverTaxonomiesSchema = z.object({
  content_type: z.string().optional().describe("Limit results to taxonomies associated with a specific content type"),
  refresh_cache: z.boolean().optional().describe("Force refresh the taxonomies cache"),
  site_id: siteIdSchema
});

const listTermsSchema = z.object({
  taxonomy: z.string().describe("The taxonomy slug or rest_base (e.g., 'category', 'post_tag', or custom taxonomies)"),
  page: z.number().optional().describe("Page number (default 1)"),
  per_page: z.number().min(1).max(100).optional().describe("Items per page (default 10, max 100)"),
  search: z.string().optional().describe("Search term for term name"),
  parent: z.number().optional().describe("Parent term ID to retrieve direct children"),
  slug: z.string().optional().describe("Limit result to terms with a specific slug"),
  hide_empty: z.boolean().optional().describe("Whether to hide terms not assigned to any content"),
  orderby: z.enum(['id', 'include', 'name', 'slug', 'term_group', 'description', 'count']).optional().describe("Sort terms by parameter"),
  order: z.enum(['asc', 'desc']).optional().describe("Order sort attribute"),
  site_id: siteIdSchema
});

const getTermSchema = z.object({
  taxonomy: z.string().describe("The taxonomy slug or rest_base"),
  id: z.number().describe("Term ID"),
  site_id: siteIdSchema
});

const createTermSchema = z.object({
  taxonomy: z.string().describe("The taxonomy slug or rest_base"),
  name: z.string().describe("Term name"),
  slug: z.string().optional().describe("Term slug"),
  parent: z.number().optional().describe("Parent term ID"),
  description: z.string().optional().describe("Term description"),
  meta: z.record(z.any()).optional().describe("Term meta fields"),
  site_id: siteIdSchema
});

const updateTermSchema = z.object({
  taxonomy: z.string().describe("The taxonomy slug or rest_base"),
  id: z.number().describe("Term ID"),
  name: z.string().optional().describe("Term name"),
  slug: z.string().optional().describe("Term slug"),
  parent: z.number().optional().describe("Parent term ID"),
  description: z.string().optional().describe("Term description"),
  meta: z.record(z.any()).optional().describe("Term meta fields"),
  site_id: siteIdSchema
});

const deleteTermSchema = z.object({
  taxonomy: z.string().describe("The taxonomy slug or rest_base"),
  id: z.number().describe("Term ID"),
  force: z.boolean().optional().describe("Required to be true, as terms do not support trashing"),
  site_id: siteIdSchema
});

const assignTermsToContentSchema = z.object({
  content_id: z.number().describe("The content ID"),
  content_type: z.string().describe("The content type slug"),
  taxonomy: z.string().describe("The taxonomy slug or rest_base"),
  terms: z.array(z.number()).describe("Array of term IDs to assign"),
  append: z.boolean().optional().describe("If true, append terms to existing ones. If false, replace all terms"),
  site_id: siteIdSchema
});

const getContentTermsSchema = z.object({
  content_id: z.number().describe("The content ID"),
  content_type: z.string().describe("The content type slug"),
  taxonomy: z.string().optional().describe("Specific taxonomy (slug or rest_base) to retrieve terms from (if not specified, returns all)"),
  site_id: siteIdSchema
});

// Type definitions
type DiscoverTaxonomiesParams = z.infer<typeof discoverTaxonomiesSchema>;
type ListTermsParams = z.infer<typeof listTermsSchema>;
type GetTermParams = z.infer<typeof getTermSchema>;
type CreateTermParams = z.infer<typeof createTermSchema>;
type UpdateTermParams = z.infer<typeof updateTermSchema>;
type DeleteTermParams = z.infer<typeof deleteTermSchema>;
type AssignTermsToContentParams = z.infer<typeof assignTermsToContentSchema>;
type GetContentTermsParams = z.infer<typeof getContentTermsSchema>;

export const unifiedTaxonomyTools: Tool[] = [
  {
    name: "discover_taxonomies",
    description: "Discovers all available taxonomies (built-in and custom) in the WordPress site, including each taxonomy's rest_base",
    inputSchema: { type: "object", properties: discoverTaxonomiesSchema.shape }
  },
  {
    name: "list_terms",
    description: "Lists terms in any taxonomy (categories, tags, or custom taxonomies) with filtering and pagination",
    inputSchema: { type: "object", properties: listTermsSchema.shape }
  },
  {
    name: "get_term",
    description: "Gets a specific term by ID from any taxonomy",
    inputSchema: { type: "object", properties: getTermSchema.shape }
  },
  {
    name: "create_term",
    description: "Creates a new term in any taxonomy",
    inputSchema: { type: "object", properties: createTermSchema.shape }
  },
  {
    name: "update_term",
    description: "Updates an existing term in any taxonomy",
    inputSchema: { type: "object", properties: updateTermSchema.shape }
  },
  {
    name: "delete_term",
    description: "Deletes a term from any taxonomy",
    inputSchema: { type: "object", properties: deleteTermSchema.shape }
  },
  {
    name: "assign_terms_to_content",
    description: "Assigns taxonomy terms to content of any type. Verifies the write against the WordPress response and errors if the terms were not actually saved.",
    inputSchema: { type: "object", properties: assignTermsToContentSchema.shape }
  },
  {
    name: "get_content_terms",
    description: "Gets all taxonomy terms assigned to content of any type",
    inputSchema: { type: "object", properties: getContentTermsSchema.shape }
  }
];

export const unifiedTaxonomyHandlers = {
  discover_taxonomies: async (params: DiscoverTaxonomiesParams) => {
    try {
      const taxonomies = await getTaxonomies(params.refresh_cache || false, params.site_id);

      // Filter by content type if specified
      let filteredTaxonomies = taxonomies;
      if (params.content_type) {
        filteredTaxonomies = Object.fromEntries(
          Object.entries(taxonomies).filter(([_, tax]: [string, any]) =>
            tax.types && tax.types.includes(params.content_type)
          )
        );
      }

      // Format the response to be more readable
      const formattedTaxonomies = Object.entries(filteredTaxonomies).map(([slug, tax]: [string, any]) => ({
        slug,
        name: tax.name,
        description: tax.description,
        types: tax.types,
        hierarchical: tax.hierarchical,
        rest_base: tax.rest_base,
        labels: tax.labels
      }));

      return {
        toolResult: {
          content: [{
            type: 'text',
            text: JSON.stringify(formattedTaxonomies, null, 2)
          }],
          isError: false
        }
      };
    } catch (error: any) {
      return {
        toolResult: {
          content: [{
            type: 'text',
            text: `Error discovering taxonomies: ${error.message}`
          }],
          isError: true
        }
      };
    }
  },

  list_terms: async (params: ListTermsParams) => {
    try {
      const { restBase } = await resolveTaxonomy(params.taxonomy, params.site_id);
      const { taxonomy, site_id, ...queryParams } = params;

      const response = await makeWordPressRequest('GET', restBase, queryParams, { siteId: site_id });

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
            text: `Error listing terms: ${error.message}`
          }],
          isError: true
        }
      };
    }
  },

  get_term: async (params: GetTermParams) => {
    try {
      const { restBase } = await resolveTaxonomy(params.taxonomy, params.site_id);

      const response = await makeWordPressRequest('GET', `${restBase}/${params.id}`, undefined, { siteId: params.site_id });

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
            text: `Error getting term: ${error.message}`
          }],
          isError: true
        }
      };
    }
  },

  create_term: async (params: CreateTermParams) => {
    try {
      const { restBase } = await resolveTaxonomy(params.taxonomy, params.site_id);

      const termData: any = {
        name: params.name
      };

      if (params.slug !== undefined) termData.slug = params.slug;
      if (params.parent !== undefined) termData.parent = params.parent;
      if (params.description !== undefined) termData.description = params.description;
      if (params.meta !== undefined) termData.meta = params.meta;

      const response = await makeWordPressRequest('POST', restBase, termData, { siteId: params.site_id });

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
            text: `Error creating term: ${error.message}`
          }],
          isError: true
        }
      };
    }
  },

  update_term: async (params: UpdateTermParams) => {
    try {
      const { restBase } = await resolveTaxonomy(params.taxonomy, params.site_id);

      const updateData: any = {};

      if (params.name !== undefined) updateData.name = params.name;
      if (params.slug !== undefined) updateData.slug = params.slug;
      if (params.parent !== undefined) updateData.parent = params.parent;
      if (params.description !== undefined) updateData.description = params.description;
      if (params.meta !== undefined) updateData.meta = params.meta;

      const response = await makeWordPressRequest('POST', `${restBase}/${params.id}`, updateData, { siteId: params.site_id });

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
            text: `Error updating term: ${error.message}`
          }],
          isError: true
        }
      };
    }
  },

  delete_term: async (params: DeleteTermParams) => {
    try {
      const { restBase } = await resolveTaxonomy(params.taxonomy, params.site_id);

      const response = await makeWordPressRequest('DELETE', `${restBase}/${params.id}`, {
        force: true // Terms require force to be true
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
            text: `Error deleting term: ${error.message}`
          }],
          isError: true
        }
      };
    }
  },

  assign_terms_to_content: async (params: AssignTermsToContentParams) => {
    try {
      // The REST field on a post object is the taxonomy's rest_base, not its
      // slug (for built-ins they coincide: categories/tags). Sending an
      // unknown field is silently ignored by WordPress, so resolving here is
      // what makes the write actually land.
      const { slug, restBase } = await resolveTaxonomy(params.taxonomy, params.site_id);
      const contentEndpoint = await getContentEndpoint(params.content_type, params.site_id);

      let termsToAssign = [...params.terms];

      // If appending, merge with the content's current terms
      if (params.append) {
        try {
          const currentContent = await makeWordPressRequest('GET', `${contentEndpoint}/${params.content_id}`, undefined, { siteId: params.site_id });
          const currentTerms: number[] = currentContent[restBase] || [];
          termsToAssign = [...new Set([...currentTerms, ...params.terms])];
        } catch (error) {
          // If we can't get current terms, just set the new ones
          logToFile(`Warning: Could not get current terms for append operation: ${error}`);
        }
      }

      const updateData = { [restBase]: termsToAssign };
      const response = await makeWordPressRequest('POST', `${contentEndpoint}/${params.content_id}`, updateData, { siteId: params.site_id });

      // Derive success from the response, not the request: WordPress returns
      // 200 even when it ignored the field entirely.
      const savedTerms: number[] | undefined = Array.isArray(response[restBase]) ? response[restBase] : undefined;
      const missing = savedTerms === undefined
        ? params.terms
        : params.terms.filter(id => !savedTerms.includes(id));

      if (missing.length > 0) {
        return {
          toolResult: {
            content: [{
              type: 'text',
              text: `Error: assignment did not stick. Requested term(s) [${params.terms.join(', ')}] for taxonomy "${slug}" (field "${restBase}"), but the updated content reports ${savedTerms === undefined ? `no "${restBase}" field — the taxonomy may not be registered for content type "${params.content_type}" or not exposed in REST` : `[${savedTerms.join(', ')}]`}. Nothing was reported as saved for: [${missing.join(', ')}].`
            }],
            isError: true
          }
        };
      }

      return {
        toolResult: {
          content: [{
            type: 'text',
            text: JSON.stringify({
              success: true,
              verified: true,
              content_id: params.content_id,
              content_type: params.content_type,
              taxonomy: slug,
              rest_base: restBase,
              assigned_terms: savedTerms,
              appended: params.append || false,
              content: {
                id: response.id,
                link: response.link,
                [restBase]: savedTerms
              }
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
            text: `Error assigning terms to content: ${error.message}`
          }],
          isError: true
        }
      };
    }
  },

  get_content_terms: async (params: GetContentTermsParams) => {
    try {
      // First, get the content to see what taxonomies are assigned
      const contentEndpoint = await getContentEndpoint(params.content_type, params.site_id);
      const content = await makeWordPressRequest('GET', `${contentEndpoint}/${params.content_id}`, undefined, { siteId: params.site_id });

      const terms: any = {};

      // Fetch full term details for a list of term IDs from a taxonomy endpoint
      const fetchTermDetails = (restBase: string, termIds: number[]) => Promise.all(
        termIds.map(async (termId: number) => {
          try {
            return await makeWordPressRequest('GET', `${restBase}/${termId}`, undefined, { siteId: params.site_id });
          } catch {
            return { id: termId, error: 'Could not fetch term details' };
          }
        })
      );

      // If specific taxonomy requested
      if (params.taxonomy) {
        const { slug, restBase } = await resolveTaxonomy(params.taxonomy, params.site_id);
        const termIds = content[restBase];

        if (Array.isArray(termIds) && termIds.length > 0) {
          terms[slug] = await fetchTermDetails(restBase, termIds);
        } else {
          terms[slug] = [];
        }
      } else {
        // Get all taxonomy terms for this content
        const taxonomies = await getTaxonomies(false, params.site_id);
        for (const [taxonomySlug, taxonomyInfo] of Object.entries(taxonomies)) {
          const tax = taxonomyInfo as any;
          // Check if this taxonomy applies to this content type
          if (tax.types && tax.types.includes(params.content_type)) {
            const restBase = tax.rest_base || taxonomySlug;
            const termIds = content[restBase];

            if (Array.isArray(termIds) && termIds.length > 0) {
              terms[taxonomySlug] = await fetchTermDetails(restBase, termIds);
            }
          }
        }
      }

      return {
        toolResult: {
          content: [{
            type: 'text',
            text: JSON.stringify({
              content_id: params.content_id,
              content_type: params.content_type,
              terms: terms
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
            text: `Error getting content terms: ${error.message}`
          }],
          isError: true
        }
      };
    }
  }
};
