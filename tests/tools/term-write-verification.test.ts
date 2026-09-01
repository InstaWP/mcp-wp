import { describe, it, expect, vi, beforeAll } from 'vitest';

// Simulates WordPress's real behaviour for term writes: wp_set_object_terms()
// silently skips term IDs that do not exist, and the REST response echoes only
// the survivors with a 200. VALID_TERMS is the set the fake site knows.
const VALID_TERMS = new Set([1, 2, 10, 11]);

vi.mock('../../src/wordpress.js', () => ({
  makeWordPressRequest: vi.fn(async (method: string, endpoint: string, data?: any) => {
    if (method === 'POST') {
      const echo: any = { id: 42, ...data };
      for (const field of ['categories', 'tags']) {
        if (data && field in data) {
          const ids = Array.isArray(data[field]) ? data[field] : [data[field]];
          echo[field] = ids.filter((id: number) => VALID_TERMS.has(id));
        }
      }
      if (data?.meta?.omit_term_fields) {
        // Simulates a content type whose REST response has no such field.
        delete echo.categories;
        delete echo.tags;
      }
      return echo;
    }
    return {};
  }),
  logToFile: vi.fn(),
}));

let updateContent: (params: any) => Promise<any>;
let createContent: (params: any) => Promise<any>;

beforeAll(async () => {
  const mod = await import('../../src/tools/unified-content.js');
  updateContent = (mod.unifiedContentHandlers as any).update_content;
  createContent = (mod.unifiedContentHandlers as any).create_content;
});

function blocksOf(result: any): Array<{ type: string; text: string }> {
  expect(result?.toolResult?.isError).not.toBe(true);
  return result.toolResult.content;
}

// The bug this file catches: update_content (and create_content) returned an
// unqualified success when WordPress silently dropped nonexistent term IDs —
// e.g. 6 tag IDs sent, 1 valid, HTTP 200, only the 1 saved, no indication of
// the other 5. assign_terms_to_content already derives success from the
// response; these handlers did not. A silent partial write is
// indistinguishable from success without this warning.
describe('update_content term verification', () => {
  it('warns and names the exact IDs WordPress dropped', async () => {
    const result = await updateContent({
      content_type: 'post',
      id: 42,
      tags: [1, 2, 3, 4, 5, 6],
    });

    const blocks = blocksOf(result);
    expect(blocks.length).toBe(2);
    expect(blocks[0].text).toContain('silently dropped');
    expect(blocks[0].text).toContain('[3, 4, 5, 6]');
    expect(blocks[0].text).toContain('saved tags [1, 2]');
  });

  it('stays a plain success when every term ID exists', async () => {
    const result = await updateContent({
      content_type: 'post',
      id: 42,
      tags: [1, 2],
      categories: [10, 11],
    });

    const blocks = blocksOf(result);
    expect(blocks.length).toBe(1);
    expect(blocks[0].text).not.toContain('Warning');
  });

  it('reports categories and tags independently', async () => {
    const result = await updateContent({
      content_type: 'post',
      id: 42,
      tags: [1],
      categories: [10, 99],
    });

    const blocks = blocksOf(result);
    expect(blocks.length).toBe(2);
    expect(blocks[0].text).toContain('categories');
    expect(blocks[0].text).toContain('[99]');
    expect(blocks[0].text).not.toContain('dropped [1]');
  });

  it('names dropped IDs in BOTH fields when both drop', async () => {
    // Kills the mutant that reports only the first dropped field: a write
    // dropping IDs in categories AND tags must name both, or the second
    // field's loss is exactly the silent partial write this feature exists
    // to surface.
    const result = await updateContent({
      content_type: 'post',
      id: 42,
      tags: [1, 3],
      categories: [10, 99],
    });

    const blocks = blocksOf(result);
    expect(blocks.length).toBe(2);
    expect(blocks[0].text).toContain('categories [10] but silently dropped [99]');
    expect(blocks[0].text).toContain('tags [1] but silently dropped [3]');
  });

  it('normalizes a bare number defensively (not reachable through the tool schema)', async () => {
    const result = await updateContent({
      content_type: 'post',
      id: 42,
      tags: 999,
    });

    const blocks = blocksOf(result);
    expect(blocks.length).toBe(2);
    expect(blocks[0].text).toContain('[999]');
  });

  it('clearing terms with an empty array is not a dropped write', async () => {
    // Pins external behaviour only: an empty request has no IDs to go
    // missing, so no code path should ever warn on a clear.
    const result = await updateContent({
      content_type: 'post',
      id: 42,
      tags: [],
    });

    expect(blocksOf(result).length).toBe(1);
  });

  it('term IDs smuggled in via custom_fields are verified too', async () => {
    // custom_fields is spread into the request payload, so tags sent that way
    // reach WordPress and can be dropped just the same. Detection reads the
    // assembled payload, not the top-level params.
    const result = await updateContent({
      content_type: 'post',
      id: 42,
      custom_fields: { tags: [1, 500] },
    });

    const blocks = blocksOf(result);
    expect(blocks.length).toBe(2);
    expect(blocks[0].text).toContain('[500]');
  });

  it('warns when the response carries no term field at all', async () => {
    // A content type without the taxonomy: WordPress ignores the field
    // entirely, so nothing at all can be confirmed.
    const result = await updateContent({
      content_type: 'post',
      id: 42,
      tags: [1, 2],
      meta: { omit_term_fields: true },
    });

    const blocks = blocksOf(result);
    expect(blocks.length).toBe(2);
    expect(blocks[0].text).toContain('no "tags" field');
    expect(blocks[0].text).toContain('[1, 2]');
  });

  it('does not warn about term fields the caller never sent', async () => {
    const result = await updateContent({
      content_type: 'post',
      id: 42,
      title: 'Only a title',
    });

    expect(blocksOf(result).length).toBe(1);
  });
});

describe('create_content term verification', () => {
  it('warns on create too, not only on update', async () => {
    const result = await createContent({
      content_type: 'post',
      title: 'New post',
      content: 'Body',
      tags: [1, 7],
    });

    const blocks = blocksOf(result);
    expect(blocks.length).toBe(2);
    expect(blocks[0].text).toContain('[7]');
  });

  it('is silent on create when the IDs are valid', async () => {
    const result = await createContent({
      content_type: 'post',
      title: 'New post',
      content: 'Body',
      tags: [1],
      categories: [10],
    });

    expect(blocksOf(result).length).toBe(1);
  });
});
