import { describe, it, expect, vi, beforeAll } from 'vitest';

// Records every request so each test can assert three things: the call carried
// { siteId } in its options exactly when site_id was supplied, site_id never
// leaked into the query/body sent to WordPress, and the payload is otherwise
// IDENTICAL to what the handler sent before site_id existed.
const calls: Array<{ method: string; endpoint: string; data: any; options: any }> = [];

vi.mock('../../src/wordpress.js', () => ({
  makeWordPressRequest: vi.fn(async (method: string, endpoint: string, data?: any, options?: any) => {
    calls.push({ method, endpoint, data, options });
    return { id: 1 };
  }),
  logToFile: vi.fn(),
}));

let pluginTools: any[], commentTools: any[], userTools: any[];
let handlers: Record<string, (params: any) => Promise<any>>;

beforeAll(async () => {
  const plugins = await import('../../src/tools/plugins.js');
  const comments = await import('../../src/tools/comments.js');
  const users = await import('../../src/tools/users.js');
  pluginTools = plugins.pluginTools;
  commentTools = comments.commentTools;
  userTools = users.userTools;
  handlers = {
    ...(plugins.pluginHandlers as any),
    ...(comments.commentHandlers as any),
    ...(users.userHandlers as any),
  };
});

// For every handler: the minimal input beyond site_id, and the exact payload
// the pre-site_id implementation sent for that input. `undefined` means the
// handler passes no data argument at all.
const CASES: Record<string, { params: any; expectData: any }> = {
  list_plugins: { params: {}, expectData: {} },
  get_plugin: { params: { plugin: 'akismet' }, expectData: undefined },
  activate_plugin: { params: { plugin: 'akismet' }, expectData: { plugin: 'akismet' } },
  deactivate_plugin: { params: { plugin: 'akismet' }, expectData: { plugin: 'akismet' } },
  create_plugin: { params: { slug: 'akismet', status: 'active' }, expectData: { slug: 'akismet', status: 'active' } },
  list_comments: { params: { post: 5 }, expectData: { post: 5 } },
  get_comment: { params: { id: 7 }, expectData: undefined },
  create_comment: { params: { post: 5, content: 'hi' }, expectData: { post: 5, content: 'hi' } },
  update_comment: { params: { id: 7, content: 'edited' }, expectData: { content: 'edited' } },
  delete_comment: { params: { id: 7, force: true }, expectData: { force: true } },
  list_users: { params: { search: 'jon' }, expectData: { search: 'jon' } },
  get_user: { params: { id: 3, context: 'edit' }, expectData: { context: 'edit' } },
  create_user: {
    params: { username: 'u', email: 'u@example.test', password: 'pw' },
    expectData: { username: 'u', email: 'u@example.test', password: 'pw' },
  },
  update_user: { params: { id: 3, name: 'New Name' }, expectData: { name: 'New Name' } },
  delete_user: { params: { id: 3, force: true, reassign: 1 }, expectData: { force: true, reassign: 1 } },
};

async function invoke(name: string, params: any) {
  const before = calls.length;
  const result = await handlers[name](params);
  expect(result?.toolResult?.isError, `${name} errored: ${JSON.stringify(result)}`).not.toBe(true);
  expect(calls.length, `${name} made no request`).toBe(before + 1);
  return calls[calls.length - 1];
}

// The bug this file catches: the fifteen plugin/comment/user tools accepted no
// site_id at all. The MCP SDK wraps each tool's zod shape in a plain (non-
// strict) z.object, so a supplied site_id was SILENTLY STRIPPED before the
// handler ran — the call went to the default site with no error, which is
// worse than a rejection. In a multi-site config there was no way to reach a
// secondary site's plugins, comments, or users.
describe('site_id routing', () => {
  for (const [name, { params, expectData }] of Object.entries(CASES)) {
    it(`${name} routes site_id to { siteId } and keeps it out of the payload`, async () => {
      // Per-handler site id, so cross-wired or hardcoded routing can't pass.
      const siteId = `site-${name}`;
      const call = await invoke(name, { ...params, site_id: siteId });

      expect(call.options?.siteId).toBe(siteId);
      expect(call.data).toEqual(expectData);
      if (call.data && typeof call.data === 'object') {
        expect(call.data).not.toHaveProperty('site_id');
      }
    });

    it(`${name} without site_id sends the exact pre-change payload to the default site`, async () => {
      // Guards existing callers: same data argument as before this feature,
      // and no siteId option, so the default-site client is selected.
      const call = await invoke(name, { ...params });

      expect(call.options?.siteId).toBeUndefined();
      expect(call.data).toEqual(expectData);
    });
  }

  it('every plugin, comment, and user tool declares site_id in its input schema', () => {
    // Guards the schema half: the SDK builds its validator from
    // inputSchema.properties, and a property missing there is stripped before
    // the handler ever sees it — the silent default-site misroute again.
    for (const tool of [...pluginTools, ...commentTools, ...userTools]) {
      expect(tool.inputSchema?.properties, `inputSchema.properties for ${tool.name}`).toBeDefined();
      expect(
        Object.keys(tool.inputSchema.properties),
        `site_id missing from ${tool.name}`
      ).toContain('site_id');
    }
  });
});
