// The WordPress endpoint in README.md is what operators paste into their own
// site, so it — not the client — is the boundary on `execute_sql_query`. It is a
// hand-maintained port of the same scanner, and a hand-maintained port drifts:
// review found it missing `/*M!`, reproducing the backtick-quoted `LOAD_FILE`
// bypass, and accepting a backslash-escaped quote the client refuses. An earlier
// version was worse still — it normalized with a list of regexes, and the ORDER
// was itself a bypass, since comments were stripped before string literals, so
// `SELECT '#' INTO OUTFILE '/tmp/x'` lost everything from the `#` and read as
// harmless.
//
// So both implementations are driven over one shared corpus and must agree, on
// every payload, with each other and with the expected verdict. The PHP function
// is extracted from README.md itself, not from a copy: a fix applied to only one
// of the two fails here.
import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import type { AddressInfo } from 'node:net';

const here = path.dirname(fileURLToPath(import.meta.url));
const README = path.join(here, '..', 'README.md');
const corpus = JSON.parse(fs.readFileSync(path.join(here, 'fixtures', 'sql-guard-corpus.json'), 'utf8')) as {
  must_reject: string[];
  must_allow: string[];
};

const state = vi.hoisted(() => ({ baseUrl: '' }));

vi.mock('../src/config/site-manager.js', () => ({
  siteManager: {
    getSite: () => ({ id: 'default', url: state.baseUrl, username: 'user', password: 'pass' })
  }
}));

const { sqlQueryHandlers } = await import('../src/tools/sql-query.js');

let server: http.Server;
let requestsReceived = 0;

beforeAll(async () => {
  server = http.createServer((req, res) => {
    requestsReceived++;
    req.resume();
    req.on('end', () => {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ results: [], num_rows: 0 }));
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  state.baseUrl = `http://127.0.0.1:${port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())));
});

/** The PHP source of the fenced ```php block in README.md. */
function readmePhp(): string {
  const md = fs.readFileSync(README, 'utf8');
  const start = md.indexOf('\n```php\n');
  expect(start, 'README.md has no ```php block').toBeGreaterThan(-1);
  const bodyStart = start + '\n```php\n'.length;
  const end = md.indexOf('\n```\n', bodyStart);
  expect(end, 'the ```php block in README.md is unterminated').toBeGreaterThan(-1);
  return md.slice(bodyStart, end);
}

function hasPhp(): boolean {
  try {
    execFileSync('php', ['-v'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

const php = hasPhp();

describe('the README WordPress endpoint agrees with the client', () => {
  it('has PHP available in CI', () => {
    // Without this the suite would skip silently on the runner and the port
    // would be pinned by nothing at all.
    if (process.env.CI) expect(php, 'php is required in CI to check the README endpoint').toBe(true);
  });

  it.skipIf(!php)('is valid PHP', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mcp-wp-readme-'));
    try {
      const file = path.join(dir, 'snippet.php');
      // Stub the WordPress functions the snippet calls, so `php -l` sees the
      // whole block rather than only the standalone function.
      fs.writeFileSync(
        file,
        '<?php\nfunction add_action($a, $b) {}\nfunction register_rest_route($a, $b, $c) {}\n' +
          'function current_user_can($c) { return true; }\nclass WP_Error { function __construct() {} }\n' +
          readmePhp()
      );
      execFileSync('php', ['-l', file], { stdio: 'pipe' });
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it.skipIf(!php)('returns the same verdict as the client on every corpus payload', async () => {
    const source = readmePhp();
    const fnEnd = source.indexOf('\nadd_action(');
    expect(fnEnd, 'the snippet no longer defines the scanner before add_action()').toBeGreaterThan(-1);

    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mcp-wp-readme-'));
    let phpVerdicts: Record<string, string>;
    try {
      const driver = path.join(dir, 'driver.php');
      const corpusFile = path.join(dir, 'corpus.json');
      fs.writeFileSync(corpusFile, JSON.stringify(corpus));
      fs.writeFileSync(
        driver,
        [
          '<?php',
          source.slice(0, fnEnd),
          // The endpoint's own checks, in order, minus WordPress itself.
          'function mcp_wp_verdict($query) {',
          "  if (!is_string($query)) return 'REJECT';",
          '  $t = ltrim($query, " \\t\\n\\r\\0\\x0B\\f");',
          "  if (stripos($t, 'SELECT') !== 0 && stripos($t, 'WITH ') !== 0 && stripos($t, 'EXPLAIN ') !== 0) return 'REJECT';",
          '  $n = mcp_wp_normalize_sql($query);',
          "  if (!is_string($n)) return 'REJECT';",
          "  if (preg_match('/;\\\\s*\\\\S/', $n)) return 'REJECT';",
          "  if (preg_match('/\\\\b(INTO|LOAD_FILE)\\\\b/i', $n)) return 'REJECT';",
          "  if (preg_match('/\\\\b(DROP|DELETE|UPDATE|ALTER|CREATE|GRANT|REVOKE)\\\\b/i', $n)) return 'REJECT';",
          "  if (preg_match('/\\\\b(INSERT|TRUNCATE)\\\\b(?!\\\\s*\\\\()/i', $n)) return 'REJECT';",
          "  return 'ALLOW';",
          '}',
          '$c = json_decode(file_get_contents($argv[1]), true);',
          '$out = array();',
          "foreach (array_merge($c['must_reject'], $c['must_allow']) as $q) { $out[$q] = mcp_wp_verdict($q); }",
          'echo json_encode($out);'
        ].join('\n')
      );
      phpVerdicts = JSON.parse(execFileSync('php', [driver, corpusFile], { encoding: 'utf8' }));
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }

    for (const [expected, payloads] of [['REJECT', corpus.must_reject], ['ALLOW', corpus.must_allow]] as const) {
      for (const query of payloads) {
        requestsReceived = 0;
        const result: any = await sqlQueryHandlers.execute_sql_query({ query });
        const client = result.toolResult.isError ? 'REJECT' : 'ALLOW';

        expect(client, `client on ${JSON.stringify(query)}`).toBe(expected);
        expect(phpVerdicts[query], `README endpoint on ${JSON.stringify(query)}`).toBe(expected);
        if (expected === 'REJECT') {
          expect(requestsReceived, `rejected but still sent: ${JSON.stringify(query)}`).toBe(0);
        }
      }
    }
  });
});
