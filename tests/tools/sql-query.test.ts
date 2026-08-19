// Regression test for the hard-coded `User-Agent: Mozilla/5.0` on
// execute_sql_query, which CDNs/WAFs treat as a bot signature and block with a
// 403 challenge page (InstaWP/mcp-wp#28).
//
// This asserts on the wire, against a real local HTTP server, rather than on the
// axios config object — so a UA reintroduced via axios.defaults or an
// interceptor is caught too.
import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from 'vitest';
import http from 'node:http';
import type { AddressInfo } from 'node:net';

const state = vi.hoisted(() => ({ baseUrl: '' }));

vi.mock('../../src/config/site-manager.js', () => ({
  siteManager: {
    getSite: () => ({
      id: 'default',
      url: state.baseUrl,
      username: 'user',
      password: 'pass'
    })
  }
}));

const { sqlQueryHandlers } = await import('../../src/tools/sql-query.js');

let server: http.Server;
let lastHeaders: http.IncomingHttpHeaders;
let respondWith: { status: number; body: string; contentType: string } = {
  status: 200,
  body: JSON.stringify([{ ID: 1 }]),
  contentType: 'application/json'
};

beforeAll(async () => {
  server = http.createServer((req, res) => {
    lastHeaders = req.headers;
    req.resume();
    req.on('end', () => {
      res.writeHead(respondWith.status, { 'Content-Type': respondWith.contentType });
      res.end(respondWith.body);
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  state.baseUrl = `http://127.0.0.1:${port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve, reject) =>
    server.close((err) => (err ? reject(err) : resolve()))
  );
});

describe('execute_sql_query request headers', () => {
  beforeEach(async () => {
    lastHeaders = {};
    delete process.env.WORDPRESS_USER_AGENT;
    respondWith = { status: 200, body: JSON.stringify([{ ID: 1 }]), contentType: 'application/json' };
    const result: any = await sqlQueryHandlers.execute_sql_query({
      query: 'SELECT 1'
    });
    // Guard: a transport failure would leave the header assertions vacuous.
    expect(result.toolResult.isError).toBeFalsy();
  });

  it('does not send a bot-signature User-Agent', () => {
    expect(lastHeaders['user-agent'] ?? '').not.toMatch(/Mozilla/i);
  });

  it('sends axios default User-Agent, not an override', () => {
    // The value every other request in the package sends, and the one the issue
    // reporter measured as un-blocked. An empty UA is also blocked by some edges.
    expect(lastHeaders['user-agent'] ?? '').toMatch(/^axios\//);
  });

  it('still sends auth and content-type', () => {
    expect(lastHeaders['content-type']).toMatch(/^application\/json/);
    expect(lastHeaders['authorization']).toBe(
      `Basic ${Buffer.from('user:pass').toString('base64')}`
    );
  });
});

describe('WORDPRESS_USER_AGENT', () => {
  const ORIGINAL = process.env.WORDPRESS_USER_AGENT;

  afterAll(() => {
    if (ORIGINAL === undefined) delete process.env.WORDPRESS_USER_AGENT;
    else process.env.WORDPRESS_USER_AGENT = ORIGINAL;
  });

  it('sends the configured user-agent when set', async () => {
    respondWith = { status: 200, body: JSON.stringify([]), contentType: 'application/json' };
    process.env.WORDPRESS_USER_AGENT = 'AllowedByOurEdge/1.2';

    const result: any = await sqlQueryHandlers.execute_sql_query({ query: 'SELECT 1' });

    expect(result.toolResult.isError).toBeFalsy();
    expect(lastHeaders['user-agent']).toBe('AllowedByOurEdge/1.2');
  });

  it('falls back to the axios default when set to whitespace', async () => {
    respondWith = { status: 200, body: JSON.stringify([]), contentType: 'application/json' };
    process.env.WORDPRESS_USER_AGENT = '   ';

    await sqlQueryHandlers.execute_sql_query({ query: 'SELECT 1' });

    expect(lastHeaders['user-agent'] ?? '').toMatch(/^axios\//);
  });
});

describe('execute_sql_query 403 handling', () => {
  beforeEach(() => {
    delete process.env.WORDPRESS_USER_AGENT;
  });

  it('explains that a 403 may be a CDN/WAF challenge and shows the body', async () => {
    respondWith = {
      status: 403,
      body: '<html><head><title>Attention Required! | Cloudflare</title></head><body>Sorry, you have been blocked</body></html>',
      contentType: 'text/html'
    };

    const result: any = await sqlQueryHandlers.execute_sql_query({ query: 'SELECT 1' });
    const text: string = result.toolResult.content[0].text;

    expect(result.toolResult.isError).toBe(true);
    expect(text).toMatch(/CDN or WAF/);
    expect(text).toMatch(/WORDPRESS_USER_AGENT/);
    // The body is what distinguishes a challenge page from a WordPress reply.
    expect(text).toContain('Attention Required');
    // Never echo the credentials back into the transcript.
    expect(text).not.toContain(Buffer.from('user:pass').toString('base64'));
  });

  it('truncates a large challenge page', async () => {
    respondWith = { status: 403, body: 'x'.repeat(5000), contentType: 'text/html' };

    const result: any = await sqlQueryHandlers.execute_sql_query({ query: 'SELECT 1' });
    const text: string = result.toolResult.content[0].text;

    expect(text).toContain('(truncated)');
    expect(text.length).toBeLessThan(2000);
  });
});
