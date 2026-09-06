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
  // caller didn't ask for a selection. WordPress treats an empty _fields as a
  // request for no fields, so every item would come back stripped.
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
});
