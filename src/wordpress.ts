// src/wordpress.ts
import * as dotenv from 'dotenv';
import axios, { AxiosInstance, AxiosRequestConfig } from 'axios';
import { siteManager } from './config/site-manager.js';

// Legacy global WordPress API client instance for backward compatibility
let wpClient: AxiosInstance;

/**
 * Initialize the WordPress API client with authentication
 * Now uses SiteManager for multi-site support
 */
export async function initWordPress() {
  // Initialize the default site client
  const client = await siteManager.getClient();
  wpClient = client;
  logToFile('WordPress client initialized successfully via SiteManager');
}

export function logToFile(message: string) {
  // Logging disabled
  return;
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
    logToFile(`Data: ${JSON.stringify(data, null, 2)}`);
  } else {
    logToFile('Request contains FormData (not shown in logs)');
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
    logToFile(requestLog);

    const response = await client.request(requestConfig);
    
    const responseLog = `
RESPONSE:
Status: ${response.status}
Data: ${JSON.stringify(response.data, null, 2)}
`;
    logToFile(responseLog);
    
    return options?.rawResponse ? response : response.data;
  } catch (error: any) {
    const errorLog = `
ERROR:
Message: ${error.message}
Status: ${error.response?.status || 'N/A'}
Data: ${JSON.stringify(error.response?.data || {}, null, 2)}
`;
    console.error(errorLog);
    logToFile(errorLog);
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
Method: GET
Params: ${JSON.stringify(requestData, null, 2)}
`;
    logToFile(requestLog);
    
    // WordPress.org Plugin API requires GET requests with serialized query parameters
    const response = await axios.get(apiUrl, {
      params: requestData,
      paramsSerializer: (params) => {
        // Serialize nested objects properly for WordPress.org API
        // Format: action=query_plugins&request[search]=term&request[page]=1
        const flatParams = new URLSearchParams();
        flatParams.append('action', params.action);
        
        Object.keys(params.request).forEach(key => {
          const value = params.request[key];
          if (typeof value === 'object' && value !== null) {
            // Handle nested objects like fields
            Object.keys(value).forEach(subKey => {
              flatParams.append(`request[${key}][${subKey}]`, String(value[subKey]));
            });
          } else {
            flatParams.append(`request[${key}]`, String(value));
          }
        });
        
        return flatParams.toString();
      }
    });
    
    const responseLog = `
WORDPRESS.ORG PLUGIN API RESPONSE:
Status: ${response.status}
Info: ${JSON.stringify(response.data.info, null, 2)}
Plugins Count: ${response.data.plugins?.length || 0}
`;
    logToFile(responseLog);
    
    return response.data;
  } catch (error: any) {
    const errorLog = `
WORDPRESS.ORG PLUGIN API ERROR:
Message: ${error.message}
Status: ${error.response?.status || 'N/A'}
Data: ${JSON.stringify(error.response?.data || {}, null, 2)}
`;
    console.error(errorLog);
    logToFile(errorLog);
    throw error;
  }
}