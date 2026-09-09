// Regression tests for the `execute_sql_query` read-only bypass reported
// privately by Syed Anas Mohiuddin (2026-09).
//
// The gate used to be: starts with SELECT/WITH/EXPLAIN, no second statement, and
// a fixed DDL/DML blocklist. `INTO OUTFILE`, `INTO DUMPFILE` and `LOAD_FILE()`
// are all valid SELECT syntax and match none of those, so an arbitrary file read
// or write passed validation while the tool description promised "only SELECT
// queries are allowed".
//
// These drive the exported handler, not the guard alone, and assert the rejected
// query NEVER REACHES THE WIRE — a guard that runs after the request is no guard.
import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from 'vitest';
import http from 'node:http';
import type { AddressInfo } from 'node:net';

const state = vi.hoisted(() => ({ baseUrl: '' }));

vi.mock('../../src/config/site-manager.js', () => ({
  siteManager: {
    getSite: () => ({ id: 'default', url: state.baseUrl, username: 'user', password: 'pass' })
  }
}));

const { sqlQueryHandlers, normalizeQuery } = await import('../../src/tools/sql-query.js');

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

beforeEach(() => {
  requestsReceived = 0;
});

async function run(query: string) {
  const result: any = await sqlQueryHandlers.execute_sql_query({ query });
  return { isError: !!result.toolResult.isError, text: result.toolResult.content[0].text as string };
}

describe('execute_sql_query rejects filesystem access disguised as a SELECT', () => {
  // The three payloads from the report, verbatim in shape.
  it('rejects LOAD_FILE (arbitrary file read)', async () => {
    const { isError, text } = await run("SELECT LOAD_FILE('/etc/passwd')");
    expect(isError).toBe(true);
    expect(text).toMatch(/LOAD_FILE/);
    expect(requestsReceived).toBe(0);
  });

  it('rejects INTO DUMPFILE (arbitrary file write — webshell drop)', async () => {
    const { isError, text } = await run(
      "SELECT '<?php system($_GET[\"cmd\"]); ?>' INTO DUMPFILE '/var/www/html/wp-content/uploads/pwn.php'"
    );
    expect(isError).toBe(true);
    expect(text).toMatch(/INTO/);
    expect(requestsReceived).toBe(0);
  });

  it('rejects INTO OUTFILE (arbitrary file write — data exfiltration)', async () => {
    const { isError } = await run(
      "SELECT user_login, user_pass FROM wp_users INTO OUTFILE '/var/www/html/wp-content/uploads/users.txt'"
    );
    expect(isError).toBe(true);
    expect(requestsReceived).toBe(0);
  });

  it('rejects a lowercase / mixed-case variant', async () => {
    expect((await run("select load_file('/etc/passwd')")).isError).toBe(true);
    expect((await run("SELECT 1 iNtO oUtFiLe '/tmp/x'")).isError).toBe(true);
    expect(requestsReceived).toBe(0);
  });

  it('rejects INTO OUTFILE split by a block comment', async () => {
    // MySQL treats a comment as whitespace, so this is the same statement.
    const { isError } = await run("SELECT 1 INTO/**/OUTFILE '/tmp/x'");
    expect(isError).toBe(true);
    expect(requestsReceived).toBe(0);
  });

  it('rejects INTO OUTFILE inside a WITH...SELECT and an EXPLAIN', async () => {
    expect((await run("WITH t AS (SELECT 1 AS a) SELECT a FROM t INTO OUTFILE '/tmp/x'")).isError).toBe(true);
    expect((await run("EXPLAIN SELECT 1 INTO OUTFILE '/tmp/x'")).isError).toBe(true);
    expect(requestsReceived).toBe(0);
  });
});

describe('execute_sql_query rejects queries it cannot read unambiguously', () => {
  it('rejects a MySQL executable comment', async () => {
    // /*! ... */ is NOT a comment: the server runs its contents, so a stripper
    // that treated it as one would smuggle a second statement past the `;` check.
    const { isError } = await run('SELECT 1 /*!50000;DROP TABLE wp_users*/');
    expect(isError).toBe(true);
    expect(requestsReceived).toBe(0);
  });

  it('rejects a MariaDB executable comment', async () => {
    // MariaDB executes /*M! ... */ and /*M!! ... */ exactly as MySQL executes
    // /*! ... */, and WordPress hosting is predominantly MariaDB. Verified on
    // MariaDB 11.8: this payload with the guard removed writes the file.
    const { isError } = await run("SELECT 'x' /*M!50000 INTO OUTFILE '/var/www/html/wp-content/uploads/pwn.php' */");
    expect(isError).toBe(true);
    expect(requestsReceived).toBe(0);

    const doubled = await run("SELECT 'x' /*M!!50000 INTO OUTFILE '/tmp/pwn' */");
    expect(doubled.isError).toBe(true);
    expect(requestsReceived).toBe(0);
  });

  it('rejects a function called by a backtick-quoted name', async () => {
    // Blanking the identifier would erase LOAD_FILE before any check saw it,
    // while the server resolves the quoted name exactly as the bare one.
    // Verified on MariaDB 11.8 and MySQL 8.0.46: this reads the file.
    const { isError } = await run("SELECT `LOAD_FILE`('/etc/passwd')");
    expect(isError).toBe(true);
    expect(requestsReceived).toBe(0);
  });

  it('rejects a function called by a double-quoted name (ANSI_QUOTES)', async () => {
    const { isError } = await run('SELECT "LOAD_FILE"(\'/etc/passwd\')');
    expect(isError).toBe(true);
    expect(requestsReceived).toBe(0);
  });

  it('rejects a quoted function name separated from its parenthesis by whitespace', async () => {
    // IGNORE_SPACE lets a builtin be called with a space before the paren.
    const { isError } = await run("SELECT `LOAD_FILE` ('/etc/passwd')");
    expect(isError).toBe(true);
    expect(requestsReceived).toBe(0);
  });

  it('rejects a backslash-escaped quote inside a literal', async () => {
    // Where the literal ends depends on the server's NO_BACKSLASH_ESCAPES mode,
    // which is the lever every quote-confusion bypass pulls.
    const { isError } = await run("SELECT 'a\\' , (SELECT 1) INTO OUTFILE '/tmp/x'");
    expect(isError).toBe(true);
    expect(requestsReceived).toBe(0);
  });

  it('rejects an unterminated string literal', async () => {
    expect((await run("SELECT 'abc")).isError).toBe(true);
    expect(requestsReceived).toBe(0);
  });

  it('rejects an unterminated block comment', async () => {
    expect((await run('SELECT 1 /* abc')).isError).toBe(true);
    expect(requestsReceived).toBe(0);
  });
});

describe('execute_sql_query still allows real read-only queries', () => {
  it('runs an ordinary SELECT', async () => {
    const { isError } = await run("SELECT ID, post_title FROM wp_posts WHERE post_status = 'publish' LIMIT 10");
    expect(isError).toBe(false);
    expect(requestsReceived).toBe(1);
  });

  it('no longer rejects a keyword that only appears inside a string literal', async () => {
    // The old blocklist matched the raw query, so this was a false positive.
    const { isError } = await run("SELECT ID FROM wp_posts WHERE post_title = 'How to drop a table'");
    expect(isError).toBe(false);
    expect(requestsReceived).toBe(1);
  });

  it('no longer rejects "into" inside a string literal', async () => {
    const { isError } = await run("SELECT ID FROM wp_posts WHERE post_title = 'Into the woods'");
    expect(isError).toBe(false);
  });

  it('allows a trailing semicolon and a quote escaped the portable way', async () => {
    const { isError } = await run("SELECT ID FROM wp_posts WHERE post_title = 'it''s fine';");
    expect(isError).toBe(false);
  });

  it('still blocks a genuine second statement', async () => {
    const { isError } = await run('SELECT 1; DROP TABLE wp_users');
    expect(isError).toBe(true);
    expect(requestsReceived).toBe(0);
  });

  it('blocks a second statement that the DDL blocklist would not catch', async () => {
    // The payload above is caught twice over — by the `;` check and by DROP — so
    // it cannot tell whether the multi-statement check works. This one can: with
    // that check disabled it is the only case in the file that stays green.
    const { isError, text } = await run('SELECT 1; SELECT 2');
    expect(isError).toBe(true);
    expect(text).toMatch(/Multiple SQL statements/);
    expect(requestsReceived).toBe(0);
  });

  it('no longer rejects an identifier that merely ends in a DDL keyword', async () => {
    // `UPDATE\s+` matched `last_update `, so this was refused as dangerous.
    const { isError } = await run('SELECT last_update FROM wp_term_taxonomy LIMIT 1');
    expect(isError).toBe(false);
  });

  it('still blocks a non-SELECT statement', async () => {
    const { isError } = await run('DELETE FROM wp_users');
    expect(isError).toBe(true);
    expect(requestsReceived).toBe(0);
  });
});

describe('normalizeQuery', () => {
  it('replaces literals, identifiers and comments with a single space', () => {
    expect(normalizeQuery("SELECT `a` FROM t WHERE x = 'y' /* c */ AND z = 1"))
      .toBe('SELECT   FROM t WHERE x =     AND z = 1');
  });

  it('collapses a comment to whitespace rather than to nothing', () => {
    // Collapsing to nothing would join the tokens either side and change meaning.
    expect(normalizeQuery('SELECT 1 INTO/**/OUTFILE')).toBe('SELECT 1 INTO OUTFILE');
  });

  it('treats -- as a comment only when whitespace follows, as MySQL does', () => {
    expect(normalizeQuery('SELECT 1 -- drop\nFROM t')).toBe('SELECT 1  \nFROM t');
    expect(normalizeQuery('SELECT 1--2')).toBe('SELECT 1--2');
  });

  it('handles a # comment', () => {
    expect(normalizeQuery('SELECT 1 # drop\nFROM t')).toBe('SELECT 1  \nFROM t');
  });

  it('does not treat a comment marker inside a literal as a comment', () => {
    expect(normalizeQuery("SELECT '-- /* #' FROM t")).toBe('SELECT   FROM t');
  });

  it('returns null on the ambiguous and unterminated cases', () => {
    expect(normalizeQuery("SELECT 'a\\'b'")).toBeNull();
    expect(normalizeQuery("SELECT 'abc")).toBeNull();
    expect(normalizeQuery('SELECT 1 /* abc')).toBeNull();
    expect(normalizeQuery('SELECT 1 /*!50000 x */')).toBeNull();
  });

  it('accepts a backslash that is not escaping a quote', () => {
    expect(normalizeQuery("SELECT 'a\\nb' FROM t")).toBe('SELECT   FROM t');
  });
});
