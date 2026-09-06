import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest';

const requests: Array<{ method: string; endpoint: string; params: any }> = [];

vi.mock('../../src/wordpress.js', () => ({
  makeWordPressRequest: vi.fn(async (method: string, endpoint: string, data?: any) => {
    requests.push({ method, endpoint, params: data });
    if (endpoint === '/wp/v2/types') {
      return { post: { slug: 'post', rest_base: 'posts' } };
    }
    return { id: 5575, slug: 'a-post', content: { raw: 'RAW BODY', rendered: '<p>x</p>' } };
  }),
  logToFile: vi.fn(),
  resolveStripFields: (envValue?: string) =>
    envValue === undefined
      ? ['yoast_head', 'yoast_head_json']
      : envValue.split(',').map(f => f.trim()).filter(Boolean),
}));

let getContent: (params: any) => Promise<any>;

beforeAll(async () => {
  const mod = await import('../../src/tools/unified-content.js');
  getContent = (mod.unifiedContentHandlers as any).get_content;
});

beforeEach(() => {
  requests.length = 0;
});

function lastItemCall() {
  const calls = requests.filter(r => r.method === 'GET' && !r.endpoint.includes('/types'));
  return calls[calls.length - 1];
}

describe('get_content field selection', () => {
  // The bug this catches: `fields` reaching WordPress under its own name.
  // WordPress spells it `_fields` and ignores unknown query args, so a straight
  // passthrough returns the whole post — including a body that can run to tens
  // of KB — while appearing to succeed.
  it('sends the selection as _fields, never as fields', async () => {
    await getContent({ content_type: 'post', id: 5575, fields: ['id', 'meta'] });

    const call = lastItemCall();
    expect(call.params._fields).toBe('id,meta');
    expect(call.params).not.toHaveProperty('fields');
  });

  // The bug this catches: sending an empty or undefined _fields when no
  // selection was asked for. WordPress ignores an empty _fields and returns the
  // full payload, so this fails silently rather than loudly.
  it('sends no params at all when nothing is requested', async () => {
    await getContent({ content_type: 'post', id: 5575 });

    expect(lastItemCall().params).toBeUndefined();
  });

  // The bug this catches: a selection that omits `content` combined with
  // include_raw_content. withContentRawAlias reads content.raw off the
  // response, so the caller would get a 200 with no content_raw and no
  // explanation — the exact silent-success shape this connector keeps hitting.
  it('refuses a selection that would strand include_raw_content', async () => {
    const result = await getContent({
      content_type: 'post',
      id: 5575,
      include_raw_content: true,
      fields: ['id', 'meta'],
    });

    expect(result.toolResult.isError).toBe(true);
    expect(result.toolResult.content[0].text).toContain('include_raw_content');
  });

  it('allows include_raw_content when content is selected, and still sets edit context', async () => {
    const result = await getContent({
      content_type: 'post',
      id: 5575,
      include_raw_content: true,
      fields: ['id', 'content'],
    });

    expect(result.toolResult.isError).toBe(false);
    const call = lastItemCall();
    expect(call.params.context).toBe('edit');
    expect(call.params._fields).toBe('id,content');
    expect(result.toolResult.content[0].text).toContain('RAW BODY');
  });

  it('accepts a nested content path for include_raw_content', async () => {
    const result = await getContent({
      content_type: 'post',
      id: 5575,
      include_raw_content: true,
      fields: ['id', 'content.raw'],
    });

    expect(result.toolResult.isError).toBe(false);
    expect(lastItemCall().params._fields).toBe('id,content.raw');
  });

  // The bug this catches: asking only for fields that trimResponseFields
  // deletes on the way out. The response would be an empty object with
  // isError false, indistinguishable from "this post has no such data".
  it('errors when every requested field is stripped from responses', async () => {
    const result = await getContent({
      content_type: 'post',
      id: 5575,
      fields: ['yoast_head'],
    });

    expect(result.toolResult.isError).toBe(true);
    expect(result.toolResult.content[0].text).toContain('MCP_WP_STRIP_FIELDS');
  });

  it('keeps edit context when raw content is requested without a selection', async () => {
    await getContent({ content_type: 'post', id: 5575, include_raw_content: true });

    const call = lastItemCall();
    expect(call.params.context).toBe('edit');
    expect(call.params).not.toHaveProperty('_fields');
  });
});
