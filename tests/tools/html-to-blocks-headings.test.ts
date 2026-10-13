import { describe, it, expect, vi, beforeAll } from 'vitest';

// Captures the body of each write so tests can inspect the exact content the
// converter produced, without any WordPress on the other end.
const writes: Array<{ endpoint: string; data: any }> = [];

vi.mock('../../src/wordpress.js', () => ({
  makeWordPressRequest: vi.fn(async (method: string, endpoint: string, data?: any) => {
    if (method === 'POST' || method === 'PUT') {
      writes.push({ endpoint, data });
      return { id: 1, ...data };
    }
    return {};
  }),
  logToFile: vi.fn(),
}));

let createContent: (params: any) => Promise<any>;

beforeAll(async () => {
  const mod = await import('../../src/tools/unified-content.js');
  createContent = (mod.unifiedContentHandlers as any).create_content;
});

async function convertViaCreate(content: string, extra: Record<string, any> = {}): Promise<string> {
  const before = writes.length;
  await createContent({
    content_type: 'post',
    title: 'Heading conversion test',
    content,
    convert_to_blocks: true,
    ...extra,
  });
  expect(writes.length).toBe(before + 1);
  return writes[writes.length - 1].data.content as string;
}

describe('convertHtmlToBlocks heading levels', () => {
  // The bug this catches: <h2> was the one heading case that emitted a bare
  // `<!-- wp:heading -->` with no {"level":2}, while h1 and h3-h6 all carried
  // their level. Converted documents came out inconsistent across heading
  // levels, and content whose blocks previously carried an explicit
  // {"level":2} appeared to have the attribute stripped after any
  // convert_to_blocks round-trip — which is exactly how it was reported from
  // the field ("stripped the level off every heading block").
  it('emits an explicit level attribute for every heading tag, h2 included', async () => {
    const html = '<h1>One</h1><h2>Two</h2><h3>Three</h3><h4>Four</h4><h5>Five</h5><h6>Six</h6>';
    const blocks = await convertViaCreate(html);

    for (const level of [1, 2, 3, 4, 5, 6]) {
      expect(blocks).toContain(`<!-- wp:heading {"level":${level}} -->`);
    }
    // No heading may fall through to the attribute-less form.
    expect(blocks).not.toMatch(/<!-- wp:heading -->/);
  });

  it('keeps the original heading element as the block body', async () => {
    const blocks = await convertViaCreate('<h2>Section title</h2>');

    expect(blocks).toContain('<!-- wp:heading {"level":2} -->\n<h2>Section title</h2>\n<!-- /wp:heading -->');
  });

  it('markdown headings get the explicit level too', async () => {
    // Markdown is the other route into the converter: ## → <h2> → wp:heading.
    const blocks = await convertViaCreate('## From markdown\n\nBody text.', {
      content_format: 'markdown',
    });

    expect(blocks).toContain('<!-- wp:heading {"level":2} -->');
    expect(blocks).not.toMatch(/<!-- wp:heading -->/);
  });

  it('content already in block format is passed through untouched', async () => {
    // Guards the pass-through: a document that already contains a bare
    // `<!-- wp:heading -->` (Gutenberg's own canonical h2 serialization) must
    // not be rewritten — the converter only runs on non-block input.
    const original = '<!-- wp:heading -->\n<h2 class="wp-block-heading">Existing</h2>\n<!-- /wp:heading -->';
    const result = await convertViaCreate(original);

    expect(result).toBe(original);
  });
});
