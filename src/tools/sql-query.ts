// src/tools/sql-query.ts
import { z } from 'zod';
import { Tool } from '@modelcontextprotocol/sdk/types.js';
import { makeWordPressRequest } from '../wordpress.js';

// Schema for SQL query execution
const executeSqlQuerySchema = z.object({
  query: z.string().describe('SQL query to execute (read-only queries: SELECT, WITH...SELECT, EXPLAIN only)')
});

// Type definition
type ExecuteSqlQueryParams = z.infer<typeof executeSqlQuerySchema>;

// Tools
export const sqlQueryTools: Tool[] = [
  {
    name: 'execute_sql_query',
    description: 'Execute a SQL query against the WordPress database. For safety, only SELECT queries are allowed. Requires the WP Fusion Database Query endpoint to be enabled.',
    inputSchema: {
      type: 'object',
      properties: executeSqlQuerySchema.shape,
      required: ['query']
    }
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
      const isExplainSelect = trimmedQuery.startsWith('EXPLAIN SELECT') || trimmedQuery.startsWith('EXPLAIN ');
      
      if (!(isSelect || isWithSelect || isExplainSelect)) {
        return {
          toolResult: {
            content: [{
              type: 'text' as const,
              text: 'Error: Only read-only queries are allowed (SELECT, WITH...SELECT, EXPLAIN SELECT). Please use a valid read-only statement.'
            }],
            isError: true
          }
        };
      }

      // Disallow multiple statements (semicolon followed by non-whitespace)
      // Remove quoted strings first to avoid false positives
      const queryWithoutStrings = query.replace(/(['"]).*?\1/g, '');
      if (/;\s*\S/.test(queryWithoutStrings)) {
        return {
          toolResult: {
            content: [{
              type: 'text' as const,
              text: 'Error: Multiple SQL statements are not allowed. Please execute one query at a time.'
            }],
            isError: true
          }
        };
      }

      // Check for dangerous patterns
      const dangerousPatterns = [
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

      for (const pattern of dangerousPatterns) {
        if (pattern.test(query)) {
          return {
            toolResult: {
              content: [{
                type: 'text' as const,
                text: `Error: Query contains potentially dangerous SQL statement. Only read-only queries are allowed.`
              }],
              isError: true
            }
          };
        }
      }

      // Execute the query via the custom endpoint
      // Use environment variable or default to /mcp/v1/query
      const sqlEndpoint = process.env.WORDPRESS_SQL_ENDPOINT || '/mcp/v1/query';
      const response = await makeWordPressRequest(
        'POST',
        sqlEndpoint,
        { query },
        { headers: { 'Content-Type': 'application/json' } }
      );

      // Handle large result sets
      const text = JSON.stringify(response, null, 2);
      const MAX_LENGTH = 50000;
      const resultText = text.length > MAX_LENGTH 
        ? text.slice(0, MAX_LENGTH) + '\n\n...(truncated - result too large)'
        : text;

      return {
        toolResult: {
          content: [{
            type: 'text' as const,
            text: resultText
          }]
        }
      };

    } catch (error: any) {
      // Check if it's a 404 error (endpoint not found)
      if (error.response?.status === 404) {
        return {
          toolResult: {
            content: [{
              type: 'text' as const,
              text: `Error: SQL query endpoint not found (HTTP 404). The custom REST API endpoint is not enabled on your WordPress site.

To enable this feature, see the setup instructions in README.md under "Enabling SQL Query Tool (Optional)".

Expected endpoint: ${process.env.WORDPRESS_SQL_ENDPOINT || '/mcp/v1/query'}
You can customize this by setting the WORDPRESS_SQL_ENDPOINT environment variable.`
            }],
            isError: true
          }
        };
      }

      return {
        toolResult: {
          content: [{
            type: 'text' as const,
            text: `Error executing SQL query: ${error.message}`
          }],
          isError: true
        }
      };
    }
  }
};
