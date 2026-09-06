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
let logToFile: any;

beforeAll(async () => {
  const mod = await import('../../src/tools/unified-content.js');
  getContent = (mod.unifiedContentHandlers as any).get_content;
  logToFile = (await import('../../src/wordpress.js')).logToFile;
});

beforeEach(() => {
  requests.length = 0;
  logToFile.mockClear?.();
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

  // The bug this catches: a guard that accepts any field under `content.`.
  // content.rendered is a sibling of content.raw and carries no raw body, so a
  // selection naming it passed the check and still returned isError false with
  // content_raw absent — the exact silent success the guard exists to prevent.
  // Confirmed against a live site before this was tightened.
  it('rejects content.rendered, which carries no raw body', async () => {
    const result = await getContent({
      content_type: 'post',
      id: 5575,
      include_raw_content: true,
      fields: ['id', 'content.rendered'],
    });

    expect(result.toolResult.isError).toBe(true);
    expect(result.toolResult.content[0].text).toContain('content.raw');
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

  // The bug this catches: a guard matched with startsWith('content') rather
  // than an exact comparison. `content_raw` is the name of the alias this tool
  // adds to its own output, not a WordPress field — an easy thing for a caller
  // to reach for, and it must not satisfy the guard.
  it('rejects content_raw, which is this tool\'s output alias and not a WP field', async () => {
    const result = await getContent({
      content_type: 'post',
      id: 5575,
      include_raw_content: true,
      fields: ['id', 'content_raw'],
    });

    expect(result.toolResult.isError).toBe(true);
  });

  // The bug this catches: comparing whole field paths against the stripped list
  // instead of their root. `yoast_head.title` is removed just as surely as
  // `yoast_head`, because trimResponseFields deletes the top-level key.
  it('errors on a nested path whose root field is stripped', async () => {
    const result = await getContent({
      content_type: 'post',
      id: 5575,
      fields: ['yoast_head.title'],
    });

    expect(result.toolResult.isError).toBe(true);
    expect(result.toolResult.content[0].text).toContain('MCP_WP_STRIP_FIELDS');
  });

  // The bug this catches: the shared helper hardcoding one tool's name in the
  // partial-overlap warning, so a get_content caller is told list_content ate
  // their field. The toolName argument exists for exactly this and nothing
  // else asserts it.
  it('names get_content in the partial-overlap warning', async () => {
    await getContent({ content_type: 'post', id: 5575, fields: ['id', 'yoast_head'] });

    const messages = logToFile.mock.calls.map((c: any[]) => String(c[0]));
    expect(messages.some(m => m.startsWith('get_content:'))).toBe(true);
  });

  // The bug this catches: MCP_WP_STRIP_FIELDS naming `content` strands
  // include_raw_content by a second route — trimResponseFields deletes the
  // field on the way out, before withContentRawAlias reads it, so content_raw
  // goes missing with isError false even with no selection at all.
  it('errors when MCP_WP_STRIP_FIELDS removes content and raw content is wanted', async () => {
    const previous = process.env.MCP_WP_STRIP_FIELDS;
    process.env.MCP_WP_STRIP_FIELDS = 'content';
    try {
      const result = await getContent({
        content_type: 'post',
        id: 5575,
        include_raw_content: true,
      });

      expect(result.toolResult.isError).toBe(true);
      expect(result.toolResult.content[0].text).toContain('MCP_WP_STRIP_FIELDS');
    } finally {
      if (previous === undefined) delete process.env.MCP_WP_STRIP_FIELDS;
      else process.env.MCP_WP_STRIP_FIELDS = previous;
    }
  });
});
