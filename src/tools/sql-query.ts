// src/tools/sql-query.ts
import { z } from 'zod';
import { Tool } from '@modelcontextprotocol/sdk/types.js';
import axios from 'axios';
import { siteManager } from '../config/site-manager.js';
import { userAgentHeader } from '../config/user-agent.js';

// Schema for SQL query execution
const executeSqlQuerySchema = z.object({
  query: z.string().describe('SQL query to execute (read-only queries: SELECT, WITH...SELECT, EXPLAIN only)'),
  site_id: z.string().optional().describe('Site ID for multi-site setups. Must match a configured site id (WORDPRESS_<n>_ID, e.g. "site1", or "default" for single-site). Domains and aliases are not resolved here; omit to use the default site.')
});

// Type definition
type ExecuteSqlQueryParams = z.infer<typeof executeSqlQuerySchema>;

const DANGEROUS_PATTERNS = [
  /DROP\s+/i,
  /DELETE\s+/i,
  /UPDATE\s+/i,
  /INSERT\s+/i,
  /TRUNCATE\s+/i,
  /ALTER\s+/i,
  /CREATE\s+/i,
  /GRANT\s+/i,
  /REVOKE\s+/i
];

// Tools
export const sqlQueryTools: Tool[] = [
  {
    name: 'execute_sql_query',
    description: 'Execute a SQL query against the WordPress database. For safety, only SELECT queries are allowed. Requires the WP Fusion Database Query endpoint to be enabled.',
    // server.ts rebuilds the schema with z.object(inputSchema.properties), so
    // properties must be zod shapes like every other tool — raw JSON Schema
    // here collapses the published schema to {} and clients strip all params.
    inputSchema: {
      type: 'object',
      properties: executeSqlQuerySchema.shape
    } as unknown as Tool['inputSchema']
  }
];

// Handlers
export const sqlQueryHandlers = {
  execute_sql_query: async (params: ExecuteSqlQueryParams) => {
    try {
      const query = params.query.trim();
      const trimmedQuery = query.toUpperCase();

      // Validate that it's a read-only query
      const isSelect = trimmedQuery.startsWith('SELECT');
      const isWithSelect = trimmedQuery.startsWith('WITH ');
      const isExplain = trimmedQuery.startsWith('EXPLAIN ');

      if (!(isSelect || isWithSelect || isExplain)) {
        return {
          toolResult: {
            content: [{ type: 'text' as const, text: 'Error: Only read-only queries are allowed (SELECT, WITH...SELECT, EXPLAIN). Please use a valid read-only statement.' }],
            isError: true
          }
        };
      }

      // Disallow multiple statements — strip quoted strings first to avoid false positives
      const queryWithoutStrings = query.replace(/(['"]).*?\1/g, '');
      if (/;\s*\S/.test(queryWithoutStrings)) {
        return {
          toolResult: {
            content: [{ type: 'text' as const, text: 'Error: Multiple SQL statements are not allowed. Please execute one query at a time.' }],
            isError: true
          }
        };
      }

      for (const pattern of DANGEROUS_PATTERNS) {
        if (pattern.test(query)) {
          return {
            toolResult: {
              content: [{ type: 'text' as const, text: 'Error: Query contains potentially dangerous SQL statement. Only read-only queries are allowed.' }],
              isError: true
            }
          };
        }
      }

      // Build absolute URL directly from site config.
      // makeWordPressRequest prepends /wp-json/wp/v2/ to all paths, so it cannot
      // be used for the SQL endpoint which lives at /wp-json/mcp/v1/query.
      const site = siteManager.getSite(params.site_id);
      const sqlPath = process.env.WORDPRESS_SQL_ENDPOINT || '/mcp/v1/query';
      const siteBase = site.url.replace(/\/$/, '');
      const url = `${siteBase}/wp-json${sqlPath}`;

      const auth = Buffer.from(`${site.username}:${site.password}`).toString('base64');

      // No User-Agent override: a bare `Mozilla/5.0` is a well-known bot
      // signature that CDNs/WAFs block with a 403 challenge page (#28). Letting
      // axios send its default also matches every other request in the package,
      // none of which sets a User-Agent. Before re-adding one here, see #30 —
      // any UA setting should be package-wide, not scoped to this one request.
      const response = await axios.post(url, { query }, {
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Basic ${auth}`,
          ...userAgentHeader()
        },
        timeout: 30000
      });

      // Handle large result sets
      const text = JSON.stringify(response.data, null, 2);
      const MAX_LENGTH = 50000;
      const resultText = text.length > MAX_LENGTH
        ? text.slice(0, MAX_LENGTH) + '\n\n...(truncated - result too large)'
        : text;

      return {
        toolResult: {
          content: [{ type: 'text' as const, text: resultText }]
        }
      };

    } catch (error: any) {
      const sqlPath = process.env.WORDPRESS_SQL_ENDPOINT || '/mcp/v1/query';

      if (error.response?.status === 403) {
        // A 403 here is ambiguous, and the ambiguity is what made #28 hard to
        // diagnose: the body is often a CDN challenge page, not a WordPress
        // response, so the endpoint looks broken when only the request was
        // filtered. Show the body so the caller can tell the two apart.
        const raw = error.response?.data;
        const body = typeof raw === 'string' ? raw : (raw === undefined ? '' : JSON.stringify(raw));
        const snippet = body.length > 500 ? `${body.slice(0, 500)}\n...(truncated)` : body;

        return {
          toolResult: {
            content: [{
              type: 'text' as const,
              text: `Error: SQL query request was rejected with HTTP 403.

Two different things produce this:
  1. WordPress rejected the credentials for the SQL endpoint.
  2. A CDN or WAF in front of the site blocked the request before it reached
     WordPress. The body below is then a challenge page ("Attention Required",
     "Access denied", a Cloudflare ray ID) rather than anything WordPress sent.

If it is (2), set WORDPRESS_USER_AGENT to a user-agent your edge allows, or
allow-list the default one. See "User Agent" in README.md.

Endpoint: ${sqlPath}
Response body${body.length > 500 ? ' (truncated)' : ''}:
${snippet || '(empty)'}`
            }],
            isError: true
          }
        };
      }

      if (error.response?.status === 404) {
        return {
          toolResult: {
            content: [{
              type: 'text' as const,
              text: `Error: SQL query endpoint not found (HTTP 404). The custom REST API endpoint is not enabled on your WordPress site.

To enable this feature, see the setup instructions in README.md under "Enabling SQL Query Tool (Optional)".

Expected endpoint: ${sqlPath}
You can customize this by setting the WORDPRESS_SQL_ENDPOINT environment variable.`
            }],
            isError: true
          }
        };
      }

      return {
        toolResult: {
          content: [{ type: 'text' as const, text: `Error executing SQL query: ${error.message}` }],
          isError: true
        }
      };
    }
  }
};
