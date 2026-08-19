// Regression test for the hard-coded `User-Agent: Mozilla/5.0` on
// execute_sql_query, which CDNs/WAFs treat as a bot signature and block with a
// 403 challenge page (InstaWP/mcp-wp#28).
import { describe, it, expect, vi, beforeEach } from 'vitest';

const postMock = vi.fn();

vi.mock('axios', () => ({
  default: { post: (...args: any[]) => postMock(...args) }
}));

vi.mock('../../src/config/site-manager.js', () => ({
  siteManager: {
    getSite: () => ({
      id: 'default',
      url: 'https://example.com',
      username: 'user',
      password: 'pass'
    })
  }
}));

const { sqlQueryHandlers } = await import('../../src/tools/sql-query.js');

describe('execute_sql_query request headers', () => {
  beforeEach(() => {
    postMock.mockReset();
    postMock.mockResolvedValue({ data: [{ ID: 1 }] });
  });

  it('does not send a User-Agent override', async () => {
    await sqlQueryHandlers.execute_sql_query({ query: 'SELECT 1' });

    expect(postMock).toHaveBeenCalledTimes(1);
    const headers = postMock.mock.calls[0][2].headers;
    const uaKeys = Object.keys(headers).filter(
      (k) => k.toLowerCase() === 'user-agent'
    );
    expect(uaKeys).toEqual([]);
  });

  it('still sends auth and content-type', async () => {
    await sqlQueryHandlers.execute_sql_query({ query: 'SELECT 1' });

    const headers = postMock.mock.calls[0][2].headers;
    expect(headers['Content-Type']).toBe('application/json');
    expect(headers['Authorization']).toBe(
      `Basic ${Buffer.from('user:pass').toString('base64')}`
    );
  });
});
