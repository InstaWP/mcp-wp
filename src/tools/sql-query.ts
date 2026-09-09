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

// Matched on word boundaries rather than as `KEYWORD\s+`: the latter fires on any
// identifier that merely ends in one, so `SELECT last_update FROM ...` was refused
// as a "dangerous SQL statement". A boundary also catches the keyword at end of
// input, which the trailing-whitespace form missed.
//
// INSERT, TRUNCATE and REPLACE are also the names of ordinary read-only
// string/numeric functions — `SELECT INSERT('Quadratic',3,4,'What')`,
// `SELECT TRUNCATE(1.234,2)`, `SELECT REPLACE(a,'x','y')` — so those three do not
// fire when a `(` follows. No statement form puts `(` straight after the keyword,
// and none of the three can reach this point anyway: the prefix check has already
// required SELECT/WITH/EXPLAIN. REPLACE is listed because `REPLACE tbl SET ...`
// needs no INTO, so nothing else here would catch it.
const DANGEROUS_PATTERNS = [
  /\bDROP\b/i,
  /\bDELETE\b/i,
  /\bUPDATE\b/i,
  /\bINSERT\b(?!\s*\()/i,
  /\bTRUNCATE\b(?!\s*\()/i,
  /\bREPLACE\b(?!\s*\()/i,
  /\bALTER\b/i,
  /\bCREATE\b/i,
  /\bGRANT\b/i,
  /\bREVOKE\b/i
];

// Constructs that are valid SELECT syntax — so they pass a "starts with SELECT"
// check and match none of the DDL/DML patterns above — but reach the filesystem
// of the database host. `SELECT ... INTO OUTFILE '/var/www/.../pwn.php'` writes a
// file; `SELECT LOAD_FILE('/etc/passwd')` reads one. Whether they succeed depends
// on the DB user's FILE privilege and on secure_file_priv, neither of which this
// package controls: mcp-wp points at arbitrary self-hosted WordPress sites.
//
// INTO is rejected wholesale rather than only `INTO OUTFILE`/`INTO DUMPFILE`:
// nothing read-only needs it, and a narrower pattern is one more thing to get
// wrong. Reported privately by Syed Anas Mohiuddin.
const FILESYSTEM_PATTERNS: { pattern: RegExp; label: string }[] = [
  { pattern: /\bINTO\b/i, label: 'INTO (including INTO OUTFILE and INTO DUMPFILE)' },
  { pattern: /\bLOAD_FILE\b/i, label: 'LOAD_FILE' }
];

const QUOTES = new Set(["'", '"', '`']);

// Stands in for a blanked string literal or quoted identifier while the scan
// runs, so a quoted token can still be told apart from ordinary whitespace once
// the whole query has been read. Replaced with a space before returning. A raw
// NUL in the input would be indistinguishable from it, so such a query is
// refused outright — nothing legitimate sends one.
const SENTINEL = '\u0000';

// What the server accepts after `--` to start a comment, for everything below
// 0x80. The lexer's test is `my_isspace(...) || my_iscntrl(...)`, i.e. every byte
// through 0x20 plus DEL — the manual's "whitespace or control character". At or
// above 0x80 the answer is charset- and engine-dependent and is refused outright
// rather than classified; see the `--` branch in normalizeQuery.
//
// This set has to equal the server's exactly, and it is wrong in BOTH directions,
// which is why neither "be generous" nor "be strict" is the rule here:
//   too WIDE  — text the server executes gets blanked, so
//               `SELECT 1--<0xA0> ... INTO OUTFILE '...'` normalizes to
//               `SELECT 1 ` and every check below sees nothing;
//   too NARROW — text the server drops is kept, pushing the tokens either side
//               apart, so `\`LOAD_FILE\`--<0x01>\n(...)` left the comment sitting
//               between the quoted name and its `(` and the adjacency test never
//               fired, on an identifier that had already been blanked.
// Both were measured, on MySQL 8.0.46 and MariaDB 11.8.8.
//
// JS's /\s/ is the too-wide end of that (U+00A0, U+2028, U+FEFF), which is why
// it is not used here.
const SQL_SPACE = /[\x00-\x20\x7f]/;

/**
 * Rewrite a query so it can be pattern-matched safely: every string literal,
 * quoted identifier and comment becomes a single space.
 *
 * Both halves matter. Without it, a keyword inside a literal is a false positive
 * (`SELECT 'drop me'` was rejected), and — the security half — a keyword split by
 * a block comment is a bypass: MySQL treats a comment between INTO and OUTFILE as
 * whitespace and runs the file write, while a raw-text blocklist sees neither
 * keyword adjacent to the other. A comment collapses to a single space, not to
 * nothing, for exactly that reason — MySQL treats it as whitespace, so we must too.
 *
 * Returns null when the query cannot be tokenized unambiguously, which callers
 * must treat as a rejection. Three cases:
 *  - an unterminated literal or block comment;
 *  - a backslash-escaped quote (`\'`) inside a literal, whose meaning depends on
 *    the server's NO_BACKSLASH_ESCAPES sql_mode — i.e. where the literal ends is
 *    not knowable from the text alone, which is precisely what quote-confusion
 *    bypasses exploit. Use '' to embed a quote instead;
 *  - a MySQL executable comment (slash-star-bang), whose contents the server runs
 *    — it is not a comment at all, and therefore cannot be stripped. MariaDB's
 *    slash-star-M-bang form is executed the same way and is refused with it;
 *  - a quoted token immediately followed by `(`, i.e. a function called by a
 *    quoted name. Blanking it the way an identifier is blanked would erase the
 *    very keyword this guard exists to see, and both engines resolve the quoted
 *    name exactly as the bare one.
 */
export function normalizeQuery(query: string): string | null {
  // A raw NUL could not be told apart from SENTINEL below, and nothing
  // legitimate sends one.
  if (query.includes(SENTINEL)) return null;

  let out = '';
  let i = 0;

  while (i < query.length) {
    const ch = query[i];

    if (QUOTES.has(ch)) {
      const quote = ch;
      i++;
      let closed = false;
      while (i < query.length) {
        const c = query[i];
        if (c === '\\' && quote !== '`') {
          const next = query[i + 1];
          // `\'` / `\"` — a literal quote under the default sql_mode, but a
          // backslash followed by a *closing* quote under NO_BACKSLASH_ESCAPES.
          if (next !== undefined && QUOTES.has(next)) return null;
          i += 2;
          continue;
        }
        if (c === quote) {
          if (query[i + 1] === quote) { i += 2; continue; } // '' escapes a quote
          i++;
          closed = true;
          break;
        }
        i++;
      }
      if (!closed) return null;

      // Emitted as a sentinel rather than a space so the "quoted token used as a
      // function name" test can run at the END, over the finished string. Doing
      // it here, as a lookahead over the RAW text, only covers the separators it
      // is written to know about — and a comment is whitespace to the server, so
      // `SELECT \`LOAD_FILE\`/**/('/etc/passwd')` read the file on MySQL 8.0.46
      // and MariaDB 11.8 while normalizing to "SELECT   ( )". By the time the
      // scan finishes every comment is already a space, so one test at the end
      // covers every separator instead of the ones someone thought of.
      out += SENTINEL;
      continue;
    }

    if (ch === '/' && query[i + 1] === '*') {
      // /*! ... */ (MySQL) and /*M! ... */ / /*M!! ... */ (MariaDB) are executable
      // comments: the server runs their contents, so a stripper that treated them
      // as comments would carry the payload past every check below. Verified on
      // MariaDB 11.8 — `SELECT 'x' /*M!50000 INTO OUTFILE '/tmp/pwn' */` writes
      // the file.
      if (/^[Mm]?!/.test(query.slice(i + 2, i + 4))) return null;
      const end = query.indexOf('*/', i + 2);
      if (end === -1) return null;
      i = end + 2;
      out += ' ';
      continue;
    }

    // Whether `--<char>` starts a comment is fixed below 0x80 and decided by
    // character_set_client at or above it — where the two engines do not even
    // agree with each other, and the same byte can be a comment starter, an
    // ordinary identifier character or an error. Guessing is unsafe in both
    // directions (see SQL_SPACE), so it is refused like every other construct
    // that cannot be read unambiguously. The client emits UTF-8 and could not
    // produce a lone high byte anyway; the rule is stated here so that both this
    // and the endpoint in README.md say the same thing.
    if (ch === '-' && query[i + 1] === '-' && query.charCodeAt(i + 2) >= 0x80) return null;

    // MySQL only starts a `--` comment when whitespace (or end of input) follows;
    // `a--b` is arithmetic. Matching that keeps us from stripping real code.
    if (ch === '-' && query[i + 1] === '-' && (query.length === i + 2 || SQL_SPACE.test(query[i + 2]))) {
      const nl = query.indexOf('\n', i);
      i = nl === -1 ? query.length : nl;
      out += ' ';
      continue;
    }

    if (ch === '#') {
      const nl = query.indexOf('\n', i);
      i = nl === -1 ? query.length : nl;
      out += ' ';
      continue;
    }

    out += ch;
    i++;
  }

  // A quoted token followed by `(` is a function called by a quoted name, and
  // both engines resolve it exactly as the bare builtin: verified on MySQL
  // 8.0.46 and MariaDB 11.8, SELECT `LOAD_FILE`('/etc/passwd') reads the file,
  // as do the ANSI_QUOTES double-quoted form and every comment-separated variant.
  // Blanking the token would erase the keyword before any check below saw it, so
  // it is refused — nothing read-only needs to call a function by a quoted name.
  // Tested here, at the end, because comments have collapsed to spaces by now:
  // one test covers every separator rather than the ones anyone thought of.
  // The separator class here is deliberately wider than whitespace: whether a
  // high byte separates two tokens is charset-dependent too (a raw 0xA0 calls the
  // builtin on both engines under latin1), and unlike the `--` rule, widening
  // this one only ever rejects more. Nothing legitimate puts a non-ASCII
  // character between an identifier and its opening parenthesis.
  if (new RegExp(`${SENTINEL}[\\s\\u0080-\\uffff]*\\(`).test(out)) return null;

  return out.split(SENTINEL).join(' ');
}

// Tools
export const sqlQueryTools: Tool[] = [
  {
    name: 'execute_sql_query',
    description: 'Execute a read-only SQL query against the WordPress database. Only SELECT, WITH...SELECT and EXPLAIN are accepted; statements that modify data, and SELECT syntax that reaches the database host filesystem (INTO OUTFILE, INTO DUMPFILE, LOAD_FILE), are rejected. Requires the WP Fusion Database Query endpoint to be enabled.',
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

      // Every check below runs against the normalized query, never the raw text:
      // a keyword hidden behind a comment must not slip past, and one inside a
      // string literal must not be a false positive.
      const normalized = normalizeQuery(query);
      if (normalized === null) {
        return {
          toolResult: {
            content: [{ type: 'text' as const, text: 'Error: Query could not be parsed unambiguously (unterminated string or comment, a backslash-escaped quote inside a literal, a /*! or /*M! executable comment, or a function called by a quoted name). Rewrite it — use \'\' to embed a quote, and call functions by their unquoted name — and try again.' }],
            isError: true
          }
        };
      }

      // Disallow multiple statements
      if (/;\s*\S/.test(normalized)) {
        return {
          toolResult: {
            content: [{ type: 'text' as const, text: 'Error: Multiple SQL statements are not allowed. Please execute one query at a time.' }],
            isError: true
          }
        };
      }

      for (const { pattern, label } of FILESYSTEM_PATTERNS) {
        if (pattern.test(normalized)) {
          return {
            toolResult: {
              content: [{ type: 'text' as const, text: `Error: Query uses ${label}, which reads or writes files on the database host. Only read-only queries that return rows are allowed.` }],
              isError: true
            }
          };
        }
      }

      for (const pattern of DANGEROUS_PATTERNS) {
        if (pattern.test(normalized)) {
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
