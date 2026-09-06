import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest';

// Captures the outgoing GET so tests can assert on the exact query WordPress
// would receive, with no WordPress on the other end.
const requests: Array<{ method: string; endpoint: string; params: any }> = [];

vi.mock('../../src/wordpress.js', () => ({
  makeWordPressRequest: vi.fn(async (method: string, endpoint: string, data?: any) => {
    requests.push({ method, endpoint, params: data });
    if (endpoint === '/wp/v2/types') {
      return { post: { slug: 'post', rest_base: 'posts' } };
    }
    return [];
  }),
  logToFile: vi.fn(),
  resolveStripFields: (envValue?: string) =>
    envValue === undefined
      ? ['yoast_head', 'yoast_head_json']
      : envValue.split(',').map(f => f.trim()).filter(Boolean),
}));

let listContent: (params: any) => Promise<any>;

beforeAll(async () => {
  const mod = await import('../../src/tools/unified-content.js');
  listContent = (mod.unifiedContentHandlers as any).list_content;
});

beforeEach(() => {
  requests.length = 0;
});

function lastListCall() {
  const listCalls = requests.filter(r => r.method === 'GET' && !r.endpoint.includes('/types'));
  return listCalls[listCalls.length - 1];
}

describe('list_content field selection', () => {
  // The bug this catches: `fields` reaching WordPress under its own name.
  // WordPress spells the parameter `_fields` and silently ignores query args it
  // doesn't recognise, so a straight passthrough returns the complete payload
  // while appearing to succeed. That failure is invisible at the call site and
  // only shows up as a response tens of times larger than asked for — which is
  // how it was hit in the field, a 90KB post body returned for a request that
  // wanted three metadata keys.
  it('sends the selection as _fields, never as fields', async () => {
    await listContent({ content_type: 'post', fields: ['id', 'slug', 'meta'] });

    const call = lastListCall();
    expect(call.params._fields).toBe('id,slug,meta');
    expect(call.params).not.toHaveProperty('fields');
  });

  // The bug this catches: sending `_fields=` (or `_fields=undefined`) when the
  // caller didn't ask for a selection. WordPress parses _fields with
  // wp_parse_list and ignores an empty one, so this would not fail loudly — it
  // would quietly return the entire payload the caller was trying to avoid,
  // looking like success. Verified against a live site: `_fields=` returns a
  // byte-identical response to sending no _fields at all.
  it('omits _fields entirely when no selection is requested', async () => {
    await listContent({ content_type: 'post', per_page: 5 });

    const call = lastListCall();
    expect(call.params).not.toHaveProperty('_fields');
    expect(call.params.per_page).toBe(5);
  });

  it('preserves the other filters alongside the selection', async () => {
    await listContent({
      content_type: 'post',
      fields: ['id'],
      per_page: 3,
      status: 'publish',
      search: 'wilmington',
    });

    const call = lastListCall();
    expect(call.params._fields).toBe('id');
    expect(call.params.per_page).toBe(3);
    expect(call.params.status).toBe('publish');
    expect(call.params.search).toBe('wilmington');
  });

  // The bug this catches: site_id or content_type leaking into the query string.
  // Both are routing inputs, not WordPress query args; content_type selects the
  // endpoint and site_id selects the client.
  it('keeps routing inputs out of the query string', async () => {
    await listContent({ content_type: 'post', fields: ['id'] });

    const call = lastListCall();
    expect(call.params).not.toHaveProperty('content_type');
    expect(call.params).not.toHaveProperty('site_id');
  });

  it('supports nested field paths verbatim', async () => {
    await listContent({ content_type: 'post', fields: ['id', 'title.rendered'] });

    expect(lastListCall().params._fields).toBe('id,title.rendered');
  });

  // The bug this catches: every response passes through trimResponseFields,
  // which deletes yoast_head/yoast_head_json (or whatever MCP_WP_STRIP_FIELDS
  // names) AFTER WordPress returns them. A selection asking only for those came
  // back as one empty object per item with isError false — indistinguishable
  // from "this site has no Yoast data", and no way for the caller to tell.
  it('errors instead of returning empty objects when every field is stripped', async () => {
    const result = await listContent({ content_type: 'post', fields: ['yoast_head'] });

    expect(result.toolResult.isError).toBe(true);
    expect(result.toolResult.content[0].text).toContain('MCP_WP_STRIP_FIELDS');
  });

  it('still serves a selection that only partly overlaps the stripped fields', async () => {
    const result = await listContent({
      content_type: 'post',
      fields: ['id', 'yoast_head'],
    });

    expect(result.toolResult.isError).toBe(false);
    expect(lastListCall().params._fields).toBe('id,yoast_head');
  });

  it('honours a narrowed MCP_WP_STRIP_FIELDS', async () => {
    const previous = process.env.MCP_WP_STRIP_FIELDS;
    process.env.MCP_WP_STRIP_FIELDS = 'something_else';
    try {
      const result = await listContent({ content_type: 'post', fields: ['yoast_head'] });
      expect(result.toolResult.isError).toBe(false);
      expect(lastListCall().params._fields).toBe('yoast_head');
    } finally {
      if (previous === undefined) delete process.env.MCP_WP_STRIP_FIELDS;
      else process.env.MCP_WP_STRIP_FIELDS = previous;
    }
  });
});
