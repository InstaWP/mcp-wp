// src/wordpress.ts
import * as dotenv from 'dotenv';
import axios, { AxiosInstance, AxiosRequestConfig } from 'axios';
import { siteManager } from './config/site-manager.js';
import { userAgentHeader } from './config/user-agent.js';

// Legacy global WordPress API client instance for backward compatibility
let wpClient: AxiosInstance;

const DEFAULT_STRIP_FIELDS = ['yoast_head', 'yoast_head_json'];

/**
 * Resolve the list of top-level fields to strip from WP REST responses.
 * Reads MCP_WP_STRIP_FIELDS (comma-separated) and falls back to the default list.
 * An empty string disables trimming.
 */
export function resolveStripFields(envValue?: string): string[] {
  if (envValue === undefined) return DEFAULT_STRIP_FIELDS;
  return envValue
    .split(',')
    .map(f => f.trim())
    .filter(f => f.length > 0);
}

/**
 * Pure function: return a shallow copy of `data` with `fields` removed at the
 * top level. Arrays of objects are mapped; nested objects are left untouched.
 * Non-object/non-array inputs (null, primitives) are returned as-is.
 */
export function trimResponseFields<T>(data: T, fields: string[]): T {
  if (fields.length === 0) return data;
  if (data === null || data === undefined) return data;

  if (Array.isArray(data)) {
    return data.map(item => trimResponseFields(item, fields)) as unknown as T;
  }

  if (typeof data === 'object') {
    const fieldSet = new Set(fields);
    const out: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(data as Record<string, unknown>)) {
      if (!fieldSet.has(key)) out[key] = value;
    }
    return out as T;
  }

  return data;
}

/**
 * Initialize the WordPress API client with authentication
 * Now uses SiteManager for multi-site support
 */
export async function initWordPress() {
  // Initialize the default site client
  const client = await siteManager.getClient();
  wpClient = client;
  logToFile('WordPress client initialized successfully via SiteManager', 'info');
}

export function logToFile(message: string, level: 'debug' | 'info' | 'error' = 'debug') {
  // Enable logging to stderr (MCP uses stdout for protocol, so we use stderr for logs)
  // Can be disabled by setting DISABLE_LOGGING=true or controlled via LOG_LEVEL
  if (process.env.DISABLE_LOGGING === 'true') return;

  const logLevel = process.env.WORDPRESS_LOG_LEVEL || 'error'; // Default to error only
  const levels = { debug: 0, info: 1, error: 2 };

  if (levels[level] >= levels[logLevel as keyof typeof levels]) {
    const timestamp = new Date().toISOString();
    const logMessage = `[${timestamp}] [${level.toUpperCase()}] ${message}\n`;
    process.stderr.write(logMessage);
  }
}

/**
 * Make a request to the WordPress API
 * @param method HTTP method
 * @param endpoint API endpoint (relative to the baseURL)
 * @param data Request data
 * @param options Additional request options including siteId for multi-site support
 * @returns Response data
 */
export async function makeWordPressRequest(
  method: string, 
  endpoint: string, 
  data?: any, 
  options?: {
    headers?: Record<string, string>;
    isFormData?: boolean;
    rawResponse?: boolean;
    siteId?: string;
  }
) {
  // Get the appropriate client for the site
  const client = options?.siteId 
    ? await siteManager.getClient(options.siteId)
    : (wpClient || await siteManager.getClient());

  // Log data (skip for FormData which can't be stringified)
  if (!options?.isFormData) {
    logToFile(`Data: ${JSON.stringify(data, null, 2)}`, 'debug');
  } else {
    logToFile('Request contains FormData (not shown in logs)', 'debug');
  }
  
  // Handle potential leading slash in endpoint
  const path = endpoint.startsWith('/') ? endpoint.substring(1) : endpoint;

  try {
    const fullUrl = `${client.defaults.baseURL}${path}`;
    
    // Prepare request config
    const requestConfig: any = {
      method,
      url: path,
      headers: options?.headers || {}
    };
    
    // Handle different data formats based on method and options
    if (method === 'GET') {
      requestConfig.params = data;
    } else if (options?.isFormData) {
      // For FormData, pass it directly without stringifying
      requestConfig.data = data;
    } else if (method === 'POST') {
      requestConfig.data = JSON.stringify(data);
    } else {
      requestConfig.data = data;
    }
    
    const requestLog = `
REQUEST:
URL: ${fullUrl}
Method: ${method}
Site: ${options?.siteId || 'default'}
Headers: ${JSON.stringify({...client.defaults.headers, ...requestConfig.headers}, null, 2)}
Data: ${options?.isFormData ? '(FormData not shown)' : JSON.stringify(data, null, 2)}
`;
    logToFile(requestLog, 'debug');

    const response = await client.request(requestConfig);

    const responseLog = `
RESPONSE:
Status: ${response.status}
Data: ${JSON.stringify(response.data, null, 2)}
`;
    logToFile(responseLog, 'debug');

    if (options?.rawResponse) return response;
    const stripFields = resolveStripFields(process.env.MCP_WP_STRIP_FIELDS);
    return trimResponseFields(response.data, stripFields);
  } catch (error: any) {
    const errorLog = `
ERROR:
Message: ${error.message}
Status: ${error.response?.status || 'N/A'}
Data: ${JSON.stringify(error.response?.data || {}, null, 2)}
`;
    logToFile(errorLog, 'error');
    throw error;
  }
}

/**
 * Make a request to the WordPress.org Plugin Repository API
 * @param searchQuery Search query string
 * @param page Page number (1-based)
 * @param perPage Number of results per page
 * @returns Response data from WordPress.org Plugin API
 */
export async function searchWordPressPluginRepository(searchQuery: string, page: number = 1, perPage: number = 10) {
  try {
    // WordPress.org Plugin API endpoint
    const apiUrl = 'https://api.wordpress.org/plugins/info/1.2/';
    
    // Build the request data according to WordPress.org Plugin API format
    const requestData = {
      action: 'query_plugins',
      request: {
        search: searchQuery,
        page: page,
        per_page: perPage,
        fields: {
          description: true,
          sections: false,
          tested: true,
          requires: true,
          rating: true,
          ratings: false,
          downloaded: true,
          downloadlink: true,
          last_updated: true,
          homepage: true,
          tags: true
        }
      }
    };
    
    const requestLog = `
WORDPRESS.ORG PLUGIN API REQUEST:
URL: ${apiUrl}
Data: ${JSON.stringify(requestData, null, 2)}
`;
    logToFile(requestLog, 'debug');

    const response = await axios.post(apiUrl, requestData, {
      headers: {
        'Content-Type': 'application/json',
        ...userAgentHeader()
      }
    });
    
    const responseLog = `
WORDPRESS.ORG PLUGIN API RESPONSE:
Status: ${response.status}
Info: ${JSON.stringify(response.data.info, null, 2)}
Plugins Count: ${response.data.plugins?.length || 0}
`;
    logToFile(responseLog, 'debug');

    return response.data;
  } catch (error: any) {
    const errorLog = `
WORDPRESS.ORG PLUGIN API ERROR:
Message: ${error.message}
Status: ${error.response?.status || 'N/A'}
Data: ${JSON.stringify(error.response?.data || {}, null, 2)}
`;
    logToFile(errorLog, 'error');
    throw error;
  }
}