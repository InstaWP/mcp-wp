// Regression test for the WordPress application password being logged in
// reversible form at debug level, reported privately by Syed Anas Mohiuddin
// (2026-09).
//
// site-manager builds `Authorization: Basic base64(user:app-password)` onto every
// client, and makeWordPressRequest logged the merged header bag verbatim. Base64
// is not encryption, so `WORDPRESS_LOG_LEVEL=debug` put the application password
// in the clear. Despite its name logToFile writes to STDERR — for a stdio MCP
// server that is captured into the host client's own log files.
//
// This asserts on what actually reaches stderr, not on the helper alone, so a
// second log site that re-introduces the header is caught too.
import { describe, it, expect, vi, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import http from 'node:http';
import axios from 'axios';
import type { AddressInfo } from 'node:net';

const APP_PASSWORD = 'abcd EFGH ijkl MNOP';
const BASIC = Buffer.from(`admin:${APP_PASSWORD}`).toString('base64');

const state = vi.hoisted(() => ({ baseUrl: '' }));

vi.mock('../src/config/site-manager.js', () => ({
  siteManager: {
    getClient: async () =>
      axios.create({
        baseURL: `${state.baseUrl}/wp-json/wp/v2/`,
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Basic ${Buffer.from('admin:abcd EFGH ijkl MNOP').toString('base64')}`,
          Cookie: 'wordpress_logged_in_deadbeef=admin%7C1780000000%7Csecrettoken'
        }
      })
  }
}));

const { makeWordPressRequest, redactHeaders } = await import('../src/wordpress.js');

let server: http.Server;
let stderr: string[];
let writeSpy: ReturnType<typeof vi.spyOn>;

beforeAll(async () => {
  server = http.createServer((req, res) => {
    req.resume();
    req.on('end', () => {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify([{ id: 1 }]));
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  state.baseUrl = `http://127.0.0.1:${port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())));
});

describe('redactHeaders', () => {
  it('redacts credential-bearing headers and keeps the rest', () => {
    const safe = redactHeaders({
      Authorization: `Basic ${BASIC}`,
      Cookie: 'a=b',
      'Content-Type': 'application/json'
    });
    expect(safe.Authorization).toBe('[REDACTED]');
    expect(safe.Cookie).toBe('[REDACTED]');
    expect(safe['Content-Type']).toBe('application/json');
  });

  it('matches header names case-insensitively', () => {
    // axios merges headers from several sources without normalizing their case.
    const safe = redactHeaders({ authorization: 'x', 'SET-COOKIE': 'y', 'Proxy-Authorization': 'z' });
    expect(safe.authorization).toBe('[REDACTED]');
    expect(safe['SET-COOKIE']).toBe('[REDACTED]');
    expect(safe['Proxy-Authorization']).toBe('[REDACTED]');
  });

  it('walks nested header bags', () => {
    // axios keeps per-method sub-objects on defaults.headers; a credential set in
    // one of those would be logged verbatim inside its parent object.
    const safe = redactHeaders({
      common: { Authorization: `Basic ${BASIC}` },
      post: { 'Content-Type': 'application/json' }
    });
    expect(safe.common.Authorization).toBe('[REDACTED]');
    expect(safe.post['Content-Type']).toBe('application/json');
    expect(JSON.stringify(safe)).not.toContain(BASIC);
  });

  it('tolerates undefined', () => {
    expect(redactHeaders(undefined)).toEqual({});
  });

  it('terminates on a cyclic bag instead of blowing the stack', () => {
    const bag: any = { Authorization: 'Basic x' };
    bag.common = bag;
    expect(() => redactHeaders(bag)).not.toThrow();
    expect(redactHeaders(bag).Authorization).toBe('[REDACTED]');
  });
});

describe('debug logging never emits the application password', () => {
  const ORIGINAL_LEVEL = process.env.WORDPRESS_LOG_LEVEL;
  const ORIGINAL_DISABLE = process.env.DISABLE_LOGGING;

  beforeEach(() => {
    stderr = [];
    delete process.env.DISABLE_LOGGING;
    process.env.WORDPRESS_LOG_LEVEL = 'debug';
    writeSpy = vi.spyOn(process.stderr, 'write').mockImplementation((chunk: any) => {
      stderr.push(String(chunk));
      return true;
    });
  });

  afterEach(() => {
    writeSpy.mockRestore();
    if (ORIGINAL_LEVEL === undefined) delete process.env.WORDPRESS_LOG_LEVEL;
    else process.env.WORDPRESS_LOG_LEVEL = ORIGINAL_LEVEL;
    if (ORIGINAL_DISABLE === undefined) delete process.env.DISABLE_LOGGING;
    else process.env.DISABLE_LOGGING = ORIGINAL_DISABLE;
  });

  it('logs the request but redacts Authorization and Cookie', async () => {
    await makeWordPressRequest('GET', 'posts', { per_page: 1 });

    const logged = stderr.join('');
    // Guard: an empty log would make the assertions below vacuous.
    expect(logged).toMatch(/REQUEST:/);
    expect(logged).toMatch(/Headers:/);

    expect(logged).not.toContain(BASIC);
    expect(logged).not.toContain(APP_PASSWORD);
    expect(logged).not.toContain('secrettoken');
    expect(logged).toContain('[REDACTED]');
  });

  it('redacts a credential in the request BODY, not only in the headers', async () => {
    // create_user/update_user pass their params straight through, so the `Data:`
    // line one below the header bag logged a WordPress user's password in
    // cleartext into the same stderr stream.
    const NEW_USER_PASSWORD = 'hunter2-correct-horse';
    await makeWordPressRequest('POST', 'users', {
      username: 'newuser',
      email: 'new@example.com',
      password: NEW_USER_PASSWORD,
      meta: { api_key: 'sk-live-should-not-appear' }
    });

    const logged = stderr.join('');
    expect(logged).toMatch(/REQUEST:/);
    expect(logged).toMatch(/Data:/);
    // The non-credential fields still appear, so this is not passing because
    // nothing was logged.
    expect(logged).toContain('newuser');

    expect(logged).not.toContain(NEW_USER_PASSWORD);
    expect(logged).not.toContain('sk-live-should-not-appear');
  });

  it('redacts credential keys under the names WordPress and plugins actually use', async () => {
    // `user_pass` is WordPress's own column name, and update_content forwards
    // arbitrary meta/custom_fields into the logged body, where a plugin's
    // `smtp_password` is an ordinary key. An exact-match key list misses both.
    await makeWordPressRequest('POST', 'posts', {
      title: 'a post',
      user_pass: 'LEAK-user-pass',
      meta: { smtp_password: 'LEAK-smtp', wp_mail_smtp_api_key: 'LEAK-apikey' },
      authors: [{ name: 'someone', accessToken: 'LEAK-token' }]
    });

    const logged = stderr.join('');
    expect(logged).toContain('a post');
    for (const secret of ['LEAK-user-pass', 'LEAK-smtp', 'LEAK-apikey', 'LEAK-token']) {
      expect(logged, secret).not.toContain(secret);
    }
  });

  it('still shows the author fields, which a substring match on "auth" would eat', async () => {
    // author, author_email, author_name, author_url and author_exclude are
    // declared params on the content and comment tools. Redacting them blinds the
    // log for the debugging it exists to serve.
    await makeWordPressRequest('POST', 'comments', {
      author: 7,
      author_name: 'Ada Lovelace',
      author_email: 'ada@example.com',
      author_url: 'https://example.com/ada',
      authorization: 'Bearer LEAK-bearer'
    });

    const logged = stderr.join('');
    expect(logged).toContain('Ada Lovelace');
    expect(logged).toContain('ada@example.com');
    expect(logged).toContain('https://example.com/ada');
    expect(logged).not.toContain('LEAK-bearer');
  });

  it('does not leak a credential past the recursion cap, and leaves non-plain values readable', async () => {
    const deep: any = { a: { b: { c: { d: { e: { f: { g: { password: 'DEEP-LEAK' } } } } } } } };
    await makeWordPressRequest('POST', 'posts', { ...deep, when: new Date('2026-01-02T03:04:05Z') });

    const logged = stderr.join('');
    expect(logged).not.toContain('DEEP-LEAK');
    // A Date must not be flattened to `{}` by the walk.
    expect(logged).toContain('2026-01-02T03:04:05');
  });
});
