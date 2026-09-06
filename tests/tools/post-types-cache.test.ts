import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import * as fs from 'fs-extra';
import * as path from 'path';
import * as os from 'os';

// Each site answers /wp/v2/types with its own post types. Where two sites share
// a custom type slug it deliberately carries a different rest_base on each —
// that is the collision that made an unkeyed cache dangerous rather than
// merely stale. Every test uses its own site ids so each is self-contained and
// runnable in isolation (vitest -t) or under --sequence.shuffle.
const SITE_TYPES: Record<string, any> = {
  siteA: {
    post: { rest_base: 'posts' },
    recipe: { rest_base: 'wprm-recipes' },
  },
  siteB: {
    post: { rest_base: 'posts' },
    recipe: { rest_base: 'site-b-recipes' },
  },
  siteC: {
    recipe: { rest_base: 'site-c-recipes' },
  },
  siteD: {
    recipe: { rest_base: 'site-d-recipes' },
  },
  siteE: {
    // No 'recipe' here: lookups for it must fall through, not borrow siteD's.
    mih_guide: { rest_base: 'mih-guides' },
  },
  siteF: {
    recipe: { rest_base: 'site-f-recipes' },
  },
  siteG: {
    recipe: { rest_base: 'site-g-recipes' },
  },
  siteH: {
    recipe: { rest_base: 'site-h-live' },
  },
  siteJ: {
    recipe: { rest_base: 'site-j-live' },
  },
  siteK: {
    recipe: { rest_base: 'site-k-live' },
  },
  // Served for requests with no siteId (the default site).
  __default__: {
    recipe: { rest_base: 'default-site-recipes' },
  },
};

const requestLog: Array<{ endpoint: string; siteId?: string }> = [];
const typesFetchCount = () => requestLog.filter((r) => r.endpoint === 'types').length;

vi.mock('../../src/wordpress.js', () => ({
  makeWordPressRequest: vi.fn(async (_method: string, endpoint: string, _data?: any, options?: { siteId?: string }) => {
    requestLog.push({ endpoint, siteId: options?.siteId });
    if (endpoint === 'types') {
      return SITE_TYPES[options?.siteId || '__default__'] ?? {};
    }
    return {};
  }),
  logToFile: vi.fn(),
}));

// CACHE_DIR is resolved at module load time from UNIFIED_CONTENT_CACHE_DIR, so
// the env var must be set before the module under test is imported — hence the
// dynamic import below instead of a top-level one. WORDPRESS_API_URL is set so
// the site manager has a configured default site (id 'default', the legacy
// single-site shape), which the default-slot tests below rely on.
const ENV_KEYS = ['UNIFIED_CONTENT_CACHE_DIR', 'WORDPRESS_API_URL', 'WORDPRESS_USERNAME', 'WORDPRESS_PASSWORD'];
let envBackup: Record<string, string | undefined>;

let getContentEndpoint: (contentType: string, siteId?: string) => Promise<string>;
let discoverContentTypes: (params: any) => Promise<any>;
let cacheDir: string;

const diskFile = (site: string) => path.join(cacheDir, `content-types-${site}.json`);

beforeAll(async () => {
  envBackup = {};
  for (const key of ENV_KEYS) envBackup[key] = process.env[key];

  cacheDir = await fs.mkdtemp(path.join(os.tmpdir(), 'mcp-wp-cache-test-'));
  process.env.UNIFIED_CONTENT_CACHE_DIR = cacheDir;
  process.env.WORDPRESS_API_URL = 'https://default.test';
  process.env.WORDPRESS_USERNAME = 'admin';
  process.env.WORDPRESS_PASSWORD = 'pw';

  const mod = await import('../../src/tools/unified-content.js');
  getContentEndpoint = mod.getContentEndpoint;
  discoverContentTypes = (mod.unifiedContentHandlers as any).discover_content_types;
});

afterAll(async () => {
  for (const key of ENV_KEYS) {
    if (envBackup[key] === undefined) delete process.env[key];
    else process.env[key] = envBackup[key];
  }
  await fs.remove(cacheDir);
});

describe('post types cache is keyed per site', () => {
  // The bug this catches: postTypesCache was a single module-level value with
  // no site key, checked BEFORE the correctly-keyed disk cache. After any call
  // for site A, a call for site B within CACHE_DURATION returned A's post
  // types — so discover_content_types listed the wrong site's types, and
  // getContentEndpoint resolved custom-type rest_bases from the wrong site
  // for every read AND write path that goes through it.
  it('does not serve one site\'s post types to another site', async () => {
    const before = typesFetchCount();

    expect(await getContentEndpoint('recipe', 'siteA')).toBe('wprm-recipes');
    // On the unkeyed cache this returned 'wprm-recipes' from siteA's entry
    // without ever asking siteB.
    expect(await getContentEndpoint('recipe', 'siteB')).toBe('site-b-recipes');

    expect(requestLog.filter((r) => r.endpoint === 'types').slice(before).map((r) => r.siteId))
      .toEqual(['siteA', 'siteB']);
  });

  it('serves a repeat lookup for the same site from the in-memory map', async () => {
    // The bug this catches: a refactor that quietly drops the memory layer
    // (every lookup becomes an fs read, or worse a refetch). The disk file is
    // deleted between calls, so only the memory map can answer the second one.
    expect(await getContentEndpoint('recipe', 'siteC')).toBe('site-c-recipes');
    await fs.remove(diskFile('siteC'));

    const before = typesFetchCount();
    expect(await getContentEndpoint('recipe', 'siteC')).toBe('site-c-recipes');
    expect(typesFetchCount()).toBe(before);
  });

  it('does not resolve a type missing from one site via another site\'s map', async () => {
    // siteD knows 'recipe'; siteE does not. With a shared cache, siteE's
    // lookup resolved to siteD's rest_base. Per-site it must fall through to
    // the documented use-as-is fallback instead.
    expect(await getContentEndpoint('recipe', 'siteD')).toBe('site-d-recipes');
    expect(await getContentEndpoint('recipe', 'siteE')).toBe('recipe');
  });

  it('writes disk cache files under distinct per-site names', async () => {
    // The disk cache was already keyed correctly; this pins that the rewiring
    // of the memory layer did not regress it.
    await getContentEndpoint('recipe', 'siteF');
    await getContentEndpoint('recipe', 'siteG');

    const files = await fs.readdir(cacheDir);
    expect(files).toContain('content-types-siteF.json');
    expect(files).toContain('content-types-siteG.json');
  });

  it('a valid disk hit warms the in-memory map', async () => {
    // The bug this catches: a disk hit that returns without populating the
    // memory entry, so every subsequent lookup re-reads the file — and, once
    // the file is gone or expired, refetches. The disk value differs from the
    // API value so a refetch is visible as data, not just as a count.
    await fs.writeJson(diskFile('siteK'), {
      data: { recipe: { rest_base: 'site-k-disk' } },
      timestamp: Date.now(),
    });
    expect(await getContentEndpoint('recipe', 'siteK')).toBe('site-k-disk');

    await fs.remove(diskFile('siteK'));
    const before = typesFetchCount();
    expect(await getContentEndpoint('recipe', 'siteK')).toBe('site-k-disk');
    expect(typesFetchCount()).toBe(before);
  });

  it('expired disk entries are refetched, not served', async () => {
    // The bug this catches: a disk hit ignoring its stored timestamp. The file
    // below is valid JSON but a full CACHE_DURATION stale.
    await fs.writeJson(diskFile('siteH'), {
      data: { recipe: { rest_base: 'site-h-stale' } },
      timestamp: Date.now() - 3600000 - 60000,
    });

    expect(await getContentEndpoint('recipe', 'siteH')).toBe('site-h-live');
  });

  it('a disk hit keeps the disk timestamp, so the memory entry expires on schedule', async () => {
    // The bug this catches: stamping the memory entry with `now` when warming
    // it from disk, which would renew the TTL on every disk hit and make an
    // old entry immortal in memory.
    vi.useFakeTimers({ toFake: ['Date'] });
    try {
      const t0 = Date.now();
      // 59 minutes old: valid for one more minute.
      await fs.writeJson(diskFile('siteJ'), {
        data: { recipe: { rest_base: 'site-j-stale' } },
        timestamp: t0 - 59 * 60000,
      });
      expect(await getContentEndpoint('recipe', 'siteJ')).toBe('site-j-stale');

      // Two minutes later both the disk file and the memory entry warmed from
      // it are past the 1h TTL — the next lookup must hit the API.
      vi.setSystemTime(t0 + 2 * 60000);
      expect(await getContentEndpoint('recipe', 'siteJ')).toBe('site-j-live');
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('the default site occupies a single cache slot', () => {
  // The bug these catch: keying on the raw parameter (`siteId || sentinel`)
  // gives the default site TWO slots — one for calls that omit site_id and one
  // for calls that pass its actual id ('default' in the legacy single-site
  // config). A forced refresh through one shape then leaves the other stale
  // for up to CACHE_DURATION.
  it('omitted site_id and the explicit default id share one memory slot', async () => {
    // Asserts consistency rather than a fixed value so it holds in any order
    // relative to the refresh test below, which changes the default site's data.
    const viaOmitted = await getContentEndpoint('recipe'); // no siteId → default site
    await fs.remove(diskFile('default'));

    const before = typesFetchCount();
    expect(await getContentEndpoint('recipe', 'default')).toBe(viaOmitted);
    expect(typesFetchCount()).toBe(before);
  });

  it('refresh_cache with no site_id also refreshes what the explicit id reads', async () => {
    await getContentEndpoint('recipe'); // warm the slot
    SITE_TYPES.__default__ = { recipe: { rest_base: 'default-site-recipes-v2' } };

    const result = await discoverContentTypes({ refresh_cache: true });
    expect(JSON.stringify(result)).toContain('default-site-recipes-v2');

    // Memory must answer with the refreshed data for the explicit-id shape too.
    await fs.remove(diskFile('default'));
    expect(await getContentEndpoint('recipe', 'default')).toBe('default-site-recipes-v2');
  });
});
