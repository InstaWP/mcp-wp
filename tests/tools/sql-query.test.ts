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

beforeAll(async () => {
  server = http.createServer((req, res) => {
    lastHeaders = req.headers;
    req.resume();
    req.on('end', () => {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify([{ ID: 1 }]));
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
