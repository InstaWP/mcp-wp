// src/tools/unified-content.ts
import { Tool } from '@modelcontextprotocol/sdk/types.js';
import { makeWordPressRequest, logToFile } from '../wordpress.js';
import { siteManager } from '../config/site-manager.js';
import { z } from 'zod';
import * as fs from 'fs-extra';
import * as path from 'path';
import * as os from 'os';
import { fileURLToPath } from 'url';
import { marked } from 'marked';

// Resolve cache directory: prefer env override, fall back to OS temp dir
const CACHE_DIR = process.env.UNIFIED_CONTENT_CACHE_DIR
  ? path.resolve(process.env.UNIFIED_CONTENT_CACHE_DIR)
  : path.join(os.tmpdir(), 'mcp-wp', '.cache');

// Ensure the cache directory exists at module load time (best-effort)
fs.ensureDir(CACHE_DIR).catch(() => {});

// Cache for post types, keyed per site, to reduce API calls.
// Mirrors the per-site pattern in unified-taxonomies.ts: an unkeyed singleton
// here let one site's post types shadow another's (the memory cache was checked
// before the correctly-keyed disk cache), so endpoint resolution for custom
// post types could use the wrong site's rest_base until a forced refresh.
interface PostTypesCacheEntry {
  data: any;
  timestamp: number;
}
const postTypesCache = new Map<string, PostTypesCacheEntry>();
const CACHE_DURATION = parseInt(process.env.WORDPRESS_CACHE_DURATION || '3600000'); // Default 1 hour, configurable

/**
 * Resolve an optional siteId to the concrete id the cache layers key on.
 *
 * Callers reach the default site two ways — omitting site_id, or passing its
 * actual id — and both must land in the same cache slot, or a forced refresh
 * through one shape leaves the other stale (and, when a *non-default* site is
 * explicitly named "default", the two sites would share a disk file).
 * Exported for unified-taxonomies.ts, whose per-site cache has the same
 * two-shapes property.
 */
export function resolveCacheSiteId(siteId?: string): string {
  if (siteId) {
    return siteId;
  }
  try {
    return siteManager.getDefaultSiteId() || '__default__';
  } catch {
    // Nothing configured yet (e.g. unit tests); still cache coherently.
    return '__default__';
  }
}

// Helper function to load cache from disk
async function loadCacheFromDisk(siteId?: string): Promise<{ data: any; timestamp: number } | null> {
  try {
    await fs.ensureDir(CACHE_DIR);
    const cacheKey = siteId || 'default';
    const cacheFilePath = path.join(CACHE_DIR, `content-types-${cacheKey}.json`);

    if (await fs.pathExists(cacheFilePath)) {
      const cache = await fs.readJson(cacheFilePath);
      return cache;
    }
  } catch (error) {
    logToFile(`Failed to load cache from disk: ${error}`, 'debug');
  }
  return null;
}

// Helper function to save cache to disk
async function saveCacheToDisk(data: any, siteId?: string): Promise<void> {
  try {
    await fs.ensureDir(CACHE_DIR);
    const cacheKey = siteId || 'default';
    const cacheFilePath = path.join(CACHE_DIR, `content-types-${cacheKey}.json`);

    await fs.writeJson(cacheFilePath, {
      data,
      timestamp: Date.now()
    });
  } catch (error) {
    logToFile(`Failed to save cache to disk: ${error}`, 'debug');
  }
}

// Helper function to get all post types with caching
async function getPostTypes(forceRefresh = false, siteId?: string) {
  const now = Date.now();
  const cacheKey = resolveCacheSiteId(siteId);

  // Try memory cache first
  const cached = postTypesCache.get(cacheKey);
  if (!forceRefresh && cached && (now - cached.timestamp) < CACHE_DURATION) {
    logToFile('Using memory-cached post types', 'debug');
    return cached.data;
  }

  // Try disk cache if memory cache is stale
  if (!forceRefresh) {
    const diskCache = await loadCacheFromDisk(cacheKey);
    if (diskCache && (now - diskCache.timestamp) < CACHE_DURATION) {
      logToFile('Using disk-cached post types', 'debug');
      postTypesCache.set(cacheKey, { data: diskCache.data, timestamp: diskCache.timestamp });
      return diskCache.data;
    }
  }

  // Fetch from API if cache is stale or refresh forced
  try {
    logToFile('Fetching post types from API', 'info');
    const response = await makeWordPressRequest('GET', 'types', undefined, { siteId });
    postTypesCache.set(cacheKey, { data: response, timestamp: now });

    // Save to disk for persistence
    await saveCacheToDisk(response, cacheKey);

    return response;
  } catch (error: any) {
    logToFile(`Error fetching post types: ${error.message}`, 'error');
    throw error;
  }
}

// Helper function to get the correct endpoint for a content type
// Exported for reuse by unified-taxonomies.ts (assign_terms_to_content / get_content_terms)
export async function getContentEndpoint(contentType: string, siteId?: string): Promise<string> {
  // Quick return for standard types
  const standardMap: Record<string, string> = {
    'post': 'posts',
    'page': 'pages'
  };

  if (standardMap[contentType]) {
    return standardMap[contentType];
  }

  // For custom post types, we need to get the rest_base from discovered types
  try {
    const postTypes = await getPostTypes(false, siteId);
    if (postTypes[contentType] && postTypes[contentType].rest_base) {
      return postTypes[contentType].rest_base;
    }
  } catch (error) {
    logToFile(`Failed to get rest_base for content type ${contentType}: ${error}`);
  }

  // Fallback: try the content type as-is
  logToFile(`Warning: No rest_base found for content type '${contentType}', using as-is`);
  return contentType;
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

  logToFile(`Searching for slug "${slug}" across content types: ${typesToSearch.join(', ')}`, 'debug');

  // Check if parallel search is enabled (default: true)
  const enableParallel = process.env.WORDPRESS_PARALLEL_SEARCH !== 'false';

  if (enableParallel && typesToSearch.length > 1) {
    // Parallel search for better performance
    const searchPromises = typesToSearch.map(async (contentType) => {
      try {
        const endpoint = await getContentEndpoint(contentType, siteId);
        const response = await makeWordPressRequest('GET', endpoint, {
          slug: slug,
          per_page: 1
        }, { siteId });

        if (Array.isArray(response) && response.length > 0) {
          logToFile(`Found content with slug "${slug}" in content type "${contentType}"`, 'info');
          return { content: response[0], contentType };
        }
      } catch (error) {
        logToFile(`Error searching ${contentType}: ${error}`, 'debug');
      }
      return null;
    });

    // Execute all searches in parallel
    const results = await Promise.all(searchPromises);

    // Return first non-null result
    const found = results.find(result => result !== null);
    if (found) return found;
  } else {
    // Sequential search (fallback or when only 1 type)
    for (const contentType of typesToSearch) {
      try {
        const endpoint = await getContentEndpoint(contentType, siteId);

        const response = await makeWordPressRequest('GET', endpoint, {
          slug: slug,
          per_page: 1
        }, { siteId });

        if (Array.isArray(response) && response.length > 0) {
          logToFile(`Found content with slug "${slug}" in content type "${contentType}"`, 'info');
          return { content: response[0], contentType };
        }
      } catch (error) {
        logToFile(`Error searching ${contentType}: ${error}`, 'debug');
      }
    }
  }

  return null;
}

// URL → post-type hint table used when resolving a public WP URL to its content type.
const URL_PATH_TYPE_HINTS: Record<string, string[]> = {
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

/**
 * Resolve a public WordPress URL to the underlying post by parsing the slug
 * and path hints, searching priority content types first and then falling back
 * to all available content types. Returns null when no content matches.
 *
 * Throws when the URL cannot be parsed into a slug — callers can surface that
 * as a distinct error from the not-found case.
 */
export async function findContentByUrl(
  url: string,
  siteId?: string
): Promise<{ content: any; contentType: string } | null> {
  const { slug, pathHints } = parseUrl(url);

  if (!slug) {
    throw new Error('Could not extract slug from URL');
  }

  const priorityTypes: string[] = [];
  for (const hint of pathHints) {
    const mapped = URL_PATH_TYPE_HINTS[hint.toLowerCase()];
    if (mapped) priorityTypes.push(...mapped);
  }
  priorityTypes.push('post', 'page');
  const typesToSearch = [...new Set(priorityTypes)];

  const result = await findContentAcrossTypes(slug, typesToSearch, siteId);
  if (result) return result;

  return findContentAcrossTypes(slug, undefined, siteId);
}

// Content format types
type ContentFormat = 'auto' | 'markdown' | 'html' | 'blocks';
type DetectedFormat = 'blocks' | 'html' | 'markdown' | 'text';
const CONTENT_EDIT_OPERATIONS = ['append', 'prepend', 'insert_before', 'insert_after', 'replace'] as const;
type ContentEditOperation = typeof CONTENT_EDIT_OPERATIONS[number];
type ContentEditParams = {
  operation: ContentEditOperation;
  value: string;
  target_text?: string;
  occurrence?: number;
  content_format?: ContentFormat;
  convert_to_blocks?: boolean;
};
type ContentUpdateInput = {
  title?: string;
  content?: string;
  content_format?: ContentFormat;
  convert_to_blocks?: boolean;
  content_edit?: ContentEditParams;
  status?: string;
  excerpt?: string;
  slug?: string;
  author?: number;
  parent?: number;
  categories?: number[];
  tags?: number[];
  featured_media?: number;
  format?: string;
  menu_order?: number;
  meta?: Record<string, any>;
  custom_fields?: Record<string, any>;
};

/**
 * Detects the format of content based on its structure
 */
function detectContentFormat(content: string): DetectedFormat {
  // Check for Gutenberg blocks first (most specific)
  if (/<!--\s*wp:/.test(content)) {
    return 'blocks';
  }

  // Check for HTML tags
  if (/<[a-z][\s\S]*>/i.test(content)) {
    return 'html';
  }

  // Check for common Markdown patterns
  const markdownPatterns = [
    /^#{1,6}\s+/m,           // Headers: # Header
    /\*\*[^*]+\*\*/,         // Bold: **text**
    /\*[^*]+\*/,             // Italic: *text*
    /\[[^\]]+\]\([^)]+\)/,   // Links: [text](url)
    /^[-*+]\s+/m,            // Unordered lists: - item
    /^\d+\.\s+/m,            // Ordered lists: 1. item
    /^>\s+/m,                // Blockquotes: > quote
    /`[^`]+`/,               // Inline code: `code`
    /^```/m,                 // Code blocks: ```
    /!\[[^\]]*\]\([^)]+\)/,  // Images: ![alt](url)
    /^---$/m,                // Horizontal rule
    /^\|.*\|$/m,             // Tables: | col1 | col2 |
  ];

  for (const pattern of markdownPatterns) {
    if (pattern.test(content)) {
      return 'markdown';
    }
  }

  return 'text';
}

/**
 * Converts Markdown to HTML using the marked library
 */
async function convertMarkdownToHtml(markdown: string): Promise<string> {
  try {
    // Configure marked for WordPress-friendly output
    const html = await marked(markdown, {
      gfm: true,       // GitHub Flavored Markdown
      breaks: false,   // Don't convert \n to <br>
    });

    return html;
  } catch (error) {
    logToFile(`Error converting markdown to HTML: ${error}`, 'error');
    throw error;
  }
}

/**
 * Converts HTML to Gutenberg block format
 * Wraps HTML elements in appropriate WordPress block comments
 */
function convertHtmlToBlocks(html: string): string {
  const blocks: string[] = [];

  // Split HTML into manageable chunks for block conversion
  // This regex matches common block-level elements
  const blockRegex = /<(p|h[1-6]|ul|ol|blockquote|pre|table|hr|div)[^>]*>[\s\S]*?<\/\1>|<(hr|br)\s*\/?>/gi;

  let match;
  let lastIndex = 0;

  while ((match = blockRegex.exec(html)) !== null) {
    // Handle any text before this match
    const textBefore = html.slice(lastIndex, match.index).trim();
    if (textBefore) {
      blocks.push(`<!-- wp:paragraph -->\n<p>${textBefore}</p>\n<!-- /wp:paragraph -->`);
    }

    const element = match[0];
    const tagName = (match[1] || match[2] || '').toLowerCase();

    switch (tagName) {
      case 'p':
        blocks.push(`<!-- wp:paragraph -->\n${element}\n<!-- /wp:paragraph -->`);
        break;
      case 'h1':
        blocks.push(`<!-- wp:heading {"level":1} -->\n${element}\n<!-- /wp:heading -->`);
        break;
      case 'h2':
        blocks.push(`<!-- wp:heading -->\n${element}\n<!-- /wp:heading -->`);
        break;
      case 'h3':
        blocks.push(`<!-- wp:heading {"level":3} -->\n${element}\n<!-- /wp:heading -->`);
        break;
      case 'h4':
        blocks.push(`<!-- wp:heading {"level":4} -->\n${element}\n<!-- /wp:heading -->`);
        break;
      case 'h5':
        blocks.push(`<!-- wp:heading {"level":5} -->\n${element}\n<!-- /wp:heading -->`);
        break;
      case 'h6':
        blocks.push(`<!-- wp:heading {"level":6} -->\n${element}\n<!-- /wp:heading -->`);
        break;
      case 'ul':
        blocks.push(`<!-- wp:list -->\n${element}\n<!-- /wp:list -->`);
        break;
      case 'ol':
        blocks.push(`<!-- wp:list {"ordered":true} -->\n${element}\n<!-- /wp:list -->`);
        break;
      case 'blockquote':
        blocks.push(`<!-- wp:quote -->\n${element}\n<!-- /wp:quote -->`);
        break;
      case 'pre':
        blocks.push(`<!-- wp:code -->\n${element}\n<!-- /wp:code -->`);
        break;
      case 'table':
        blocks.push(`<!-- wp:table -->\n<figure class="wp-block-table">${element}</figure>\n<!-- /wp:table -->`);
        break;
      case 'hr':
        blocks.push(`<!-- wp:separator -->\n<hr class="wp-block-separator has-alpha-channel-opacity"/>\n<!-- /wp:separator -->`);
        break;
      default:
        // Wrap unknown elements in a paragraph block
        blocks.push(`<!-- wp:paragraph -->\n${element}\n<!-- /wp:paragraph -->`);
    }

    lastIndex = match.index + match[0].length;
  }

  // Handle any remaining content after the last match
  const remaining = html.slice(lastIndex).trim();
  if (remaining) {
    blocks.push(`<!-- wp:paragraph -->\n<p>${remaining}</p>\n<!-- /wp:paragraph -->`);
  }

  // If no blocks were created, wrap the entire content
  if (blocks.length === 0 && html.trim()) {
    return `<!-- wp:paragraph -->\n<p>${html}</p>\n<!-- /wp:paragraph -->`;
  }

  return blocks.join('\n\n');
}

/**
 * Main content processing function
 * Handles format detection, conversion, and optional block wrapping
 */
async function processContent(
  content: string,
  format: ContentFormat = 'auto',
  convertToBlocks: boolean = false
): Promise<string> {
  // Early return for empty content
  if (!content || !content.trim()) {
    return content;
  }

  // Detect format if auto
  let detectedFormat: DetectedFormat;
  if (format === 'auto') {
    detectedFormat = detectContentFormat(content);
    logToFile(`Auto-detected content format: ${detectedFormat}`, 'debug');
  } else {
    detectedFormat = format === 'blocks' ? 'blocks' : format === 'html' ? 'html' : format === 'markdown' ? 'markdown' : 'text';
  }

  // If content is already blocks, pass through as-is
  if (detectedFormat === 'blocks') {
    logToFile('Content is already in Gutenberg block format, passing through', 'debug');
    return content;
  }

  // Convert markdown to HTML if needed
  let htmlContent: string;
  if (detectedFormat === 'markdown') {
    logToFile('Converting markdown to HTML', 'debug');
    htmlContent = await convertMarkdownToHtml(content);
  } else if (detectedFormat === 'html') {
    htmlContent = content;
  } else {
    // Plain text - wrap in paragraph tags
    htmlContent = `<p>${content.replace(/\n\n/g, '</p>\n<p>').replace(/\n/g, '<br>')}</p>`;
  }

  // Convert to blocks if requested
  if (convertToBlocks) {
    logToFile('Converting HTML to Gutenberg blocks', 'debug');
    return convertHtmlToBlocks(htmlContent);
  }

  return htmlContent;
}

// Return the meta keys that were sent in the request but don't appear in
// the WP response's `meta` object. WordPress silently drops unregistered
// meta keys on writes to /wp/v2/{type}/{id}, so absence in the echoed
// response is the signal that a key wasn't persisted. The `responseData`
// is the parsed WP REST response; we look for `responseData.meta` as the
// echoed object. If the response shape is unexpected (no meta object,
// or meta returned as an array rather than the usual keyed object), we
// treat every sent key as dropped — conservative, but matches the
// underlying "we can't confirm it stuck" signal.
export function detectDroppedMetaKeys(
  sent: Record<string, unknown> | undefined,
  responseData: unknown
): string[] {
  if (!sent) return [];
  const sentKeys = Object.keys(sent);
  if (sentKeys.length === 0) return [];
  if (!responseData || typeof responseData !== 'object' || Array.isArray(responseData)) {
    return sentKeys;
  }
  const returnedMeta = (responseData as Record<string, unknown>).meta;
  if (!returnedMeta || typeof returnedMeta !== 'object' || Array.isArray(returnedMeta)) {
    return sentKeys;
  }
  const returnedKeys = new Set(Object.keys(returnedMeta as Record<string, unknown>));
  return sentKeys.filter(k => !returnedKeys.has(k));
}

export function buildDroppedMetaWarning(droppedKeys: string[]): string {
  return (
    `Warning: WordPress did not persist these meta keys: ${droppedKeys.join(', ')}. ` +
    `This usually means they are not registered for REST exposure via ` +
    `register_post_meta(..., show_in_rest => true). Common culprits are SEO ` +
    `plugin keys (Yoast _yoast_wpseo_*, Rank Math rank_math_*, AIOSEO _aioseo_*) ` +
    `which the plugins do not expose on the core /wp/v2/ endpoints by default. ` +
    `See README "Meta field limitations" for context.`
  );
}

function validateContentEdit(edit: ContentEditParams) {
  const targetedOperations = new Set<ContentEditOperation>(['insert_before', 'insert_after', 'replace']);

  if (targetedOperations.has(edit.operation) && !edit.target_text) {
    throw new Error(`content_edit.target_text is required for ${edit.operation}`);
  }
}

function getTargetMatchIndex(content: string, targetText: string, occurrence?: number): number {
  const matches: number[] = [];
  let fromIndex = 0;

  while (true) {
    const matchIndex = content.indexOf(targetText, fromIndex);
    if (matchIndex === -1) {
      break;
    }

    matches.push(matchIndex);
    fromIndex = matchIndex + targetText.length;
  }

  if (matches.length === 0) {
    throw new Error('content_edit.target_text was not found in the existing content');
  }

  if (occurrence === undefined) {
    if (matches.length > 1) {
      throw new Error(`content_edit.target_text matched ${matches.length} locations. Provide content_edit.occurrence to disambiguate.`);
    }
    return matches[0];
  }

  if (!Number.isInteger(occurrence) || occurrence < 1) {
    throw new Error('content_edit.occurrence must be a positive integer');
  }

  const resolvedIndex = matches[occurrence - 1];
  if (resolvedIndex === undefined) {
    throw new Error(`content_edit.occurrence ${occurrence} is out of range for ${matches.length} matches`);
  }

  return resolvedIndex;
}

function applyContentEdit(existingContent: string, edit: ContentEditParams): string {
  validateContentEdit(edit);

  switch (edit.operation) {
    case 'append':
      return `${existingContent}${edit.value}`;
    case 'prepend':
      return `${edit.value}${existingContent}`;
    case 'insert_before': {
      const targetText = edit.target_text as string;
      const targetIndex = getTargetMatchIndex(existingContent, targetText, edit.occurrence);
      return `${existingContent.slice(0, targetIndex)}${edit.value}${existingContent.slice(targetIndex)}`;
    }
    case 'insert_after': {
      const targetText = edit.target_text as string;
      const targetIndex = getTargetMatchIndex(existingContent, targetText, edit.occurrence) + targetText.length;
      return `${existingContent.slice(0, targetIndex)}${edit.value}${existingContent.slice(targetIndex)}`;
    }
    case 'replace': {
      const targetText = edit.target_text as string;
      const targetIndex = getTargetMatchIndex(existingContent, targetText, edit.occurrence);
      return `${existingContent.slice(0, targetIndex)}${edit.value}${existingContent.slice(targetIndex + targetText.length)}`;
    }
  }
}

async function getEditableRawContent(endpoint: string, id: number, siteId?: string): Promise<string> {
  const response = await fetchContentById(endpoint, id, siteId, true);

  const rawContent = response?.content?.raw;
  if (typeof rawContent !== 'string') {
    throw new Error('Partial content edits require WordPress edit access and a REST response that includes content.raw');
  }

  return rawContent;
}

function withContentRawAlias<T extends Record<string, any>>(response: T): T & { content_raw?: string } {
  const rawContent = response?.content?.raw;
  if (typeof rawContent !== 'string') {
    return response;
  }

  return {
    ...response,
    content_raw: rawContent
  };
}

async function fetchContentById(
  endpoint: string,
  id: number,
  siteId?: string,
  includeRawContent: boolean = false
) {
  const response = await makeWordPressRequest(
    'GET',
    `${endpoint}/${id}`,
    includeRawContent ? { context: 'edit' } : undefined,
    { siteId }
  );

  return includeRawContent ? withContentRawAlias(response) : response;
}

async function resolveUpdatedContent(
  input: ContentUpdateInput,
  endpoint: string,
  id: number,
  siteId?: string
): Promise<string | undefined> {
  if (input.content !== undefined && input.content_edit !== undefined) {
    throw new Error('Provide either content or content_edit, not both');
  }

  if (input.content !== undefined) {
    return processContent(
      input.content,
      input.content_format || 'auto',
      input.convert_to_blocks || false
    );
  }

  if (input.content_edit !== undefined) {
    validateContentEdit(input.content_edit);

    const existingContent = await getEditableRawContent(endpoint, id, siteId);
    const processedFragment = await processContent(
      input.content_edit.value,
      input.content_edit.content_format || 'auto',
      input.content_edit.convert_to_blocks || false
    );

    return applyContentEdit(existingContent, {
      ...input.content_edit,
      value: processedFragment
    });
  }

  return undefined;
}

async function buildContentUpdateData(
  input: ContentUpdateInput,
  endpoint: string,
  id: number,
  siteId?: string
) {
  const updateData: any = {};

  if (input.title !== undefined) updateData.title = input.title;

  const updatedContent = await resolveUpdatedContent(input, endpoint, id, siteId);
  if (updatedContent !== undefined) updateData.content = updatedContent;

  if (input.status !== undefined) updateData.status = input.status;
  if (input.excerpt !== undefined) updateData.excerpt = input.excerpt;
  if (input.slug !== undefined) updateData.slug = input.slug;
  if (input.author !== undefined) updateData.author = input.author;
  if (input.parent !== undefined) updateData.parent = input.parent;
  if (input.featured_media !== undefined) updateData.featured_media = input.featured_media;
  if (input.format !== undefined) updateData.format = input.format;
  if (input.menu_order !== undefined) updateData.menu_order = input.menu_order;
  if (input.categories !== undefined) updateData.categories = input.categories;
  if (input.tags !== undefined) updateData.tags = input.tags;
  if (input.meta !== undefined) updateData.meta = input.meta;

  if (input.custom_fields) {
    Object.assign(updateData, input.custom_fields);
  }

  return updateData;
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
  id: z.coerce.number().describe("Content ID"),
  site_id: z.string().optional().describe("Site ID (for multi-site setups)"),
  include_raw_content: z.boolean().optional().default(false).describe(
    "Fetch the content with WordPress edit context and include a top-level content_raw field for exact matching"
  )
});

const createContentSchema = z.object({
  content_type: z.string().describe("The content type slug"),
  site_id: z.string().optional().describe("Site ID (for multi-site setups)"),
  title: z.string().describe("Content title"),
  content: z.string().describe(
    "Content body. Accepts: Gutenberg blocks (<!-- wp:paragraph --><p>text</p><!-- /wp:paragraph -->), " +
    "HTML, or Markdown. Markdown is auto-converted to HTML when detected."
  ),
  content_format: z.enum(['auto', 'markdown', 'html', 'blocks']).optional().default('auto').describe(
    "Content format hint: 'auto' (detect and convert), 'markdown', 'html', or 'blocks' (Gutenberg)"
  ),
  convert_to_blocks: z.boolean().optional().default(false).describe(
    "Convert content to Gutenberg blocks. Recommended for sites using block editor."
  ),
  status: z.string().optional().default('draft').describe("Content status"),
  excerpt: z.string().optional().describe("Content excerpt"),
  slug: z.string().optional().describe("Content slug"),
  author: z.number().optional().describe("Author ID"),
  parent: z.number().optional().describe("Parent ID (for hierarchical content)"),
  categories: z.array(z.number()).optional().describe("Array of category IDs (for posts)"),
  tags: z.array(z.number()).optional().describe("Array of tag IDs (for posts)"),
  featured_media: z.number().optional().describe("Featured image ID"),
  format: z.string().optional().describe("Post format (standard, aside, gallery, etc.)"),
  menu_order: z.number().optional().describe("Menu order (for pages)"),
  meta: z.record(z.any()).optional().describe("Meta fields"),
  custom_fields: z.record(z.any()).optional().describe("Custom fields specific to this content type")
});

const contentEditSchema = z.object({
  operation: z.enum(CONTENT_EDIT_OPERATIONS).describe(
    "Partial content edit operation: append, prepend, insert_before, insert_after, or replace"
  ),
  value: z.string().describe(
    "Content fragment to insert or use as the replacement. Accepts Gutenberg blocks, HTML, or Markdown."
  ),
  target_text: z.string().optional().describe(
    "Exact raw content fragment to target for insert_before, insert_after, or replace"
  ),
  occurrence: z.number().int().positive().optional().describe(
    "Optional 1-based occurrence to target when target_text appears multiple times"
  ),
  content_format: z.enum(['auto', 'markdown', 'html', 'blocks']).optional().default('auto').describe(
    "Format hint for the content_edit value"
  ),
  convert_to_blocks: z.boolean().optional().default(false).describe(
    "Convert the content_edit value to Gutenberg blocks before applying it"
  )
}).superRefine((value, ctx) => {
  const targetedOperations = new Set<ContentEditOperation>(['insert_before', 'insert_after', 'replace']);
  if (targetedOperations.has(value.operation) && !value.target_text) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: `target_text is required for ${value.operation}`,
      path: ['target_text']
    });
  }
});

const updateContentSchemaShape = {
  content_type: z.string().describe("The content type slug"),
  id: z.coerce.number().describe("Content ID"),
  site_id: z.string().optional().describe("Site ID (for multi-site setups)"),
  title: z.string().optional().describe("Content title"),
  content: z.string().optional().describe(
    "Content body. Accepts: Gutenberg blocks (<!-- wp:paragraph --><p>text</p><!-- /wp:paragraph -->), " +
    "HTML, or Markdown. Markdown is auto-converted to HTML when detected."
  ),
  content_format: z.enum(['auto', 'markdown', 'html', 'blocks']).optional().default('auto').describe(
    "Content format hint: 'auto' (detect and convert), 'markdown', 'html', or 'blocks' (Gutenberg)"
  ),
  convert_to_blocks: z.boolean().optional().default(false).describe(
    "Convert content to Gutenberg blocks. Recommended for sites using block editor."
  ),
  content_edit: contentEditSchema.optional().describe(
    "Apply a targeted edit to the existing raw content instead of replacing the whole document. " +
    "Mutually exclusive with `content` — provide one or the other, not both."
  ),
  status: z.string().optional().describe("Content status"),
  excerpt: z.string().optional().describe("Content excerpt"),
  slug: z.string().optional().describe("Content slug"),
  author: z.number().optional().describe("Author ID"),
  parent: z.number().optional().describe("Parent ID"),
  categories: z.array(z.number()).optional().describe("Array of category IDs"),
  tags: z.array(z.number()).optional().describe("Array of tag IDs"),
  featured_media: z.number().optional().describe("Featured image ID"),
  format: z.string().optional().describe("Post format (standard, aside, gallery, etc.)"),
  menu_order: z.number().optional().describe("Menu order"),
  meta: z.record(z.any()).optional().describe("Meta fields"),
  custom_fields: z.record(z.any()).optional().describe("Custom fields")
};

// NOTE: mutual exclusion of `content` and `content_edit` is enforced at runtime
// in resolveUpdatedContent(). A top-level superRefine here would be dead code:
// the MCP server registers tools from the raw shape (updateContentSchemaShape),
// so an outer-object refinement never reaches the validation layer. The
// constraint is documented on the content_edit field description instead.
const updateContentSchema = z.object(updateContentSchemaShape);

const deleteContentSchema = z.object({
  content_type: z.string().describe("The content type slug"),
  id: z.coerce.number().describe("Content ID"),
  site_id: z.string().optional().describe("Site ID (for multi-site setups)"),
  force: z.boolean().optional().describe("Whether to bypass trash and force deletion")
});

const discoverContentTypesSchema = z.object({
  refresh_cache: z.boolean().optional().describe("Force refresh the content types cache"),
  site_id: z.string().optional().describe("Site ID (for multi-site setups)")
});

const findContentByUrlUpdateFieldsShape = {
  title: z.string().optional(),
  content: z.string().optional().describe(
    "Content body. Accepts Gutenberg blocks, HTML, or Markdown (auto-converted to HTML)."
  ),
  content_format: z.enum(['auto', 'markdown', 'html', 'blocks']).optional().default('auto'),
  convert_to_blocks: z.boolean().optional().default(false),
  content_edit: contentEditSchema.optional().describe(
    "Apply a targeted edit to the existing raw content instead of replacing the whole document. " +
    "Mutually exclusive with `content` — provide one or the other, not both."
  ),
  status: z.string().optional(),
  meta: z.record(z.any()).optional(),
  custom_fields: z.record(z.any()).optional()
};

const findContentByUrlSchema = z.object({
  url: z.string().describe("The full URL of the content to find"),
  site_id: z.string().optional().describe("Site ID (for multi-site setups)"),
  include_raw_content: z.boolean().optional().default(false).describe(
    "Fetch the matched content with WordPress edit context and include a top-level content_raw field for exact matching"
  ),
  // Mutual exclusion of content/content_edit is enforced at runtime in
  // resolveUpdatedContent() and documented on the content_edit field; an outer
  // superRefine here is dead code (tools register from the raw shape).
  update_fields: z.object(findContentByUrlUpdateFieldsShape).optional().describe("Optional fields to update after finding the content")
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
    inputSchema: { type: "object", properties: updateContentSchemaShape }
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
    inputSchema: { type: "object", properties: {
      url: z.string().describe("The full URL of the content to find"),
      site_id: z.string().optional().describe("Site ID (for multi-site setups)"),
      include_raw_content: z.boolean().optional().default(false).describe(
        "Fetch the matched content with WordPress edit context and include a top-level content_raw field for exact matching"
      ),
      update_fields: z.object(findContentByUrlUpdateFieldsShape).optional().describe("Optional fields to update after finding the content")
    } }
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
      const endpoint = await getContentEndpoint(params.content_type, params.site_id);
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
      // Add helpful guidance for agents
      const guidance = error.message.includes('404') || error.message.includes('Not Found')
        ? '\nHint: Try running discover_content_types first to see available content types.'
        : '';
      return {
        toolResult: {
          content: [{
            type: 'text',
            text: `Error listing content: ${error.message}${guidance}`
          }],
          isError: true
        }
      };
    }
  },

  get_content: async (params: GetContentParams) => {
    try {
      const endpoint = await getContentEndpoint(params.content_type, params.site_id);
      const response = await fetchContentById(
        endpoint,
        params.id,
        params.site_id,
        params.include_raw_content || false
      );

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
      const guidance = error.message.includes('404') || error.message.includes('Not Found')
        ? '\nHint: Check if the content type exists with discover_content_types.'
        : '';
      return {
        toolResult: {
          content: [{
            type: 'text',
            text: `Error getting content: ${error.message}${guidance}`
          }],
          isError: true
        }
      };
    }
  },

  create_content: async (params: CreateContentParams) => {
    try {
      const endpoint = await getContentEndpoint(params.content_type, params.site_id);

      // Process content format (markdown -> HTML, optional block conversion)
      const processedContent = await processContent(
        params.content,
        params.content_format || 'auto',
        params.convert_to_blocks || false
      );

      const contentData: any = {
        title: params.title,
        content: processedContent,
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

      const responseContent: any[] = [{
        type: 'text',
        text: JSON.stringify(response, null, 2)
      }];
      const droppedMeta = detectDroppedMetaKeys(params.meta, response);
      if (droppedMeta.length > 0) {
        responseContent.unshift({ type: 'text', text: buildDroppedMetaWarning(droppedMeta) });
      }

      return {
        toolResult: {
          content: responseContent,
          isError: false
        }
      };
    } catch (error: any) {
      const guidance = error.message.includes('404') || error.message.includes('Not Found')
        ? '\nHint: The content type may not exist. Run discover_content_types to see available types.'
        : '';
      return {
        toolResult: {
          content: [{
            type: 'text',
            text: `Error creating content: ${error.message}${guidance}`
          }],
          isError: true
        }
      };
    }
  },

  update_content: async (params: UpdateContentParams) => {
    try {
      const endpoint = await getContentEndpoint(params.content_type, params.site_id);
      const updateData = await buildContentUpdateData(params, endpoint, params.id, params.site_id);
      
      const response = await makeWordPressRequest('POST', `${endpoint}/${params.id}`, updateData, { siteId: params.site_id });

      const responseContent: any[] = [{
        type: 'text',
        text: JSON.stringify(response, null, 2)
      }];
      const droppedMeta = detectDroppedMetaKeys(params.meta, response);
      if (droppedMeta.length > 0) {
        responseContent.unshift({ type: 'text', text: buildDroppedMetaWarning(droppedMeta) });
      }

      return {
        toolResult: {
          content: responseContent,
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
      const endpoint = await getContentEndpoint(params.content_type, params.site_id);
      
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
      const result = await findContentByUrl(params.url, params.site_id);

      if (!result) {
        throw new Error(`No content found with URL: ${params.url}`);
      }

      const { content, contentType } = result;

      if (params.update_fields) {
        const endpoint = await getContentEndpoint(contentType, params.site_id);
        const updateData = await buildContentUpdateData(
          params.update_fields,
          endpoint,
          content.id,
          params.site_id
        );

        await makeWordPressRequest('POST', `${endpoint}/${content.id}`, updateData, { siteId: params.site_id });
        const updatedContent = await fetchContentById(endpoint, content.id, params.site_id, params.include_raw_content || false);

        const responseContent: any[] = [{
          type: 'text',
          text: JSON.stringify({
            found: true,
            content_type: contentType,
            content_id: content.id,
            original_url: params.url,
            updated: true,
            content: updatedContent,
            content_raw: params.include_raw_content ? updatedContent.content_raw : undefined
          }, null, 2)
        }];
        const droppedMeta = detectDroppedMetaKeys(params.update_fields.meta, updatedContent);
        if (droppedMeta.length > 0) {
          responseContent.unshift({ type: 'text', text: buildDroppedMetaWarning(droppedMeta) });
        }

        return {
          toolResult: {
            content: responseContent,
            isError: false
          }
        };
      }

      const responseContent = params.include_raw_content
        ? await fetchContentById(await getContentEndpoint(contentType, params.site_id), content.id, params.site_id, true)
        : content;

      return {
        toolResult: {
          content: [{
            type: 'text',
            text: JSON.stringify({
              found: true,
              content_type: contentType,
              content_id: content.id,
              original_url: params.url,
              content: responseContent,
              content_raw: params.include_raw_content ? responseContent.content_raw : undefined
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
