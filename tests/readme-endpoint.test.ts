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
// every payload, with each other and with the expected verdict. The PHP is
// extracted from README.md itself and EXECUTED — WordPress's four functions are
// stubbed, the registered callback is captured and called, and `$wpdb` records
// whether the query would have run. Nothing here re-implements the endpoint's
// checks, so deleting one of them in the README fails this test.
//
// Two limits worth stating rather than discovering. This is NOT an authorization
// test: `current_user_can` is stubbed true, because the real gate is the route's
// `permission_callback`, which WordPress applies before the callback runs. And
// the corpus is a list of strings, so the non-string cases are driven separately
// below — without that, the endpoint's `is_string()` guard could be deleted with
// every assertion here still green.
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
  const body = md.slice(bodyStart, end);
  // Guards against the extraction silently matching something else.
  expect(body, 'the ```php block does not define the scanner').toContain('function mcp_wp_normalize_sql');
  expect(body, 'the ```php block does not register the endpoint').toContain('register_rest_route');
  return body;
}

/** Just enough WordPress for the snippet to run, plus a driver over the corpus. */
const PHP_HARNESS_HEAD = `<?php
$MCP_WP_CALLBACK = null;
define('ARRAY_A', 'ARRAY_A');

class MCP_WP_Wpdb {
    public $last_error = '';
    public $ran = null;
    public function get_results($query, $mode = null) { $this->ran = $query; return array(); }
}
class WP_Error {
    public $code;
    public function __construct($code = '', $message = '', $data = array()) { $this->code = $code; }
}
class MCP_WP_Request {
    private $params;
    public function __construct($params) { $this->params = $params; }
    public function get_param($key) { return array_key_exists($key, $this->params) ? $this->params[$key] : null; }
}
function current_user_can($capability) { return true; }
function register_rest_route($namespace, $route, $args) { $GLOBALS['MCP_WP_CALLBACK'] = $args['callback']; }
// Run the registration closure immediately rather than on a hook.
function add_action($hook, $callback) { $callback(); }
$wpdb = new MCP_WP_Wpdb();
`;

const PHP_HARNESS_TAIL = `
$callback = $GLOBALS['MCP_WP_CALLBACK'];
if (!is_callable($callback)) { fwrite(STDERR, "no callback registered\\n"); exit(2); }

$corpus = json_decode(file_get_contents($argv[1]), true);
$out = array();
foreach (array_merge($corpus['must_reject'], $corpus['must_allow']) as $query) {
    $GLOBALS['wpdb']->ran = null;
    $result = $callback(new MCP_WP_Request(array('query' => $query)));
    $out[$query] = array(
        'verdict' => ($result instanceof WP_Error) ? 'REJECT' : 'ALLOW',
        'ran' => $GLOBALS['wpdb']->ran !== null,
    );
}

// A JSON body can send anything. Not expressible in the corpus, which is a list
// of strings, so it is driven separately — without it the endpoint's is_string()
// guard could be deleted with every test still green.
// Raw high bytes cannot be written into the corpus either: it is UTF-8 JSON, so
// a "\\u00a0" entry reaches PHP as C2 A0, which is a different string. Whether a
// high byte after a double dash starts a comment is charset- and engine-dependent,
// so it is refused; both directions of getting that wrong are bypasses.
$high = array();
foreach (array(0xA0, 0xFF) as $byte) {
    $c = chr($byte);
    $high['__blanked_' . dechex($byte) . '__'] =
        "SELECT 1--$c FROM (SELECT 1 AS x) t INTO OUTFILE '/tmp/pwn'";
    $high['__kept_' . dechex($byte) . '__'] =
        "SELECT \`LOAD_FILE\`--$c\n('/etc/passwd')";
}
foreach ($high as $label => $payload) {
    $GLOBALS['wpdb']->ran = null;
    $result = $callback(new MCP_WP_Request(array('query' => $payload)));
    $out[$label] = array(
        'verdict' => ($result instanceof WP_Error) ? 'REJECT' : 'ALLOW',
        'ran' => $GLOBALS['wpdb']->ran !== null,
    );
}

foreach (array('__non_string__' => array(), '__null__' => null) as $label => $payload) {
    $GLOBALS['wpdb']->ran = null;
    $result = $callback(new MCP_WP_Request(array('query' => $payload)));
    $out[$label] = array(
        'verdict' => ($result instanceof WP_Error) ? 'REJECT' : 'ALLOW',
        'ran' => $GLOBALS['wpdb']->ran !== null,
    );
}

echo json_encode($out);
`;

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

  it('has a corpus with payloads in it', () => {
    // A guard against every assertion below passing over an empty list.
    expect(corpus.must_reject.length).toBeGreaterThan(20);
    expect(corpus.must_allow.length).toBeGreaterThan(8);
  });

  it.skipIf(!php)('is valid PHP', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mcp-wp-readme-'));
    try {
      const file = path.join(dir, 'snippet.php');
      fs.writeFileSync(file, PHP_HARNESS_HEAD + readmePhp());
      execFileSync('php', ['-l', file], { stdio: 'pipe' });
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it.skipIf(!php)('returns the same verdict as the client on every corpus payload', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mcp-wp-readme-'));
    let endpoint: Record<string, { verdict: string; ran: boolean }>;
    try {
      const driver = path.join(dir, 'driver.php');
      const corpusFile = path.join(dir, 'corpus.json');
      fs.writeFileSync(corpusFile, JSON.stringify(corpus));
      fs.writeFileSync(driver, PHP_HARNESS_HEAD + readmePhp() + PHP_HARNESS_TAIL);
      endpoint = JSON.parse(execFileSync('php', [driver, corpusFile], { encoding: 'utf8' }));
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }

    // The harness reached the endpoint at all.
    const extra = ['__blanked_a0__', '__kept_a0__', '__blanked_ff__', '__kept_ff__', '__non_string__', '__null__'];
    expect(Object.keys(endpoint).length).toBe(corpus.must_reject.length + corpus.must_allow.length + extra.length);
    expect(Object.values(endpoint).some((r) => r.ran)).toBe(true);

    // Not expressible in the corpus — it is a UTF-8 JSON list of strings, so it
    // can hold neither a non-string nor a lone high byte. Asserted directly.
    for (const label of extra) {
      expect(endpoint[label].verdict, `endpoint on ${label}`).toBe('REJECT');
      expect(endpoint[label].ran, `endpoint queried anyway on ${label}`).toBe(false);
    }

    for (const [expected, payloads] of [['REJECT', corpus.must_reject], ['ALLOW', corpus.must_allow]] as const) {
      for (const query of payloads) {
        requestsReceived = 0;
        const result: any = await sqlQueryHandlers.execute_sql_query({ query });
        const client = result.toolResult.isError ? 'REJECT' : 'ALLOW';

        expect(client, `client on ${JSON.stringify(query)}`).toBe(expected);
        expect(endpoint[query].verdict, `README endpoint on ${JSON.stringify(query)}`).toBe(expected);
        if (expected === 'REJECT') {
          expect(requestsReceived, `client rejected but still sent: ${JSON.stringify(query)}`).toBe(0);
          expect(endpoint[query].ran, `endpoint rejected but still queried: ${JSON.stringify(query)}`).toBe(false);
        }
      }
    }
  });
});
