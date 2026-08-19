import { describe, it, expect, afterEach } from 'vitest';
import { resolveUserAgent, userAgentHeader } from '../../src/config/user-agent.js';

const ORIGINAL = process.env.WORDPRESS_USER_AGENT;

afterEach(() => {
  if (ORIGINAL === undefined) delete process.env.WORDPRESS_USER_AGENT;
  else process.env.WORDPRESS_USER_AGENT = ORIGINAL;
});

describe('resolveUserAgent', () => {
  it('is undefined when unset, so axios keeps its own default', () => {
    delete process.env.WORDPRESS_USER_AGENT;
    expect(resolveUserAgent()).toBeUndefined();
    expect(userAgentHeader()).toEqual({});
  });

  it('treats an empty or whitespace-only value as unset', () => {
    // An empty User-Agent is blocked by some edges too — it must not be sent.
    expect(resolveUserAgent('')).toBeUndefined();
    expect(resolveUserAgent('   ')).toBeUndefined();
    expect(userAgentHeader('  ')).toEqual({});
  });

  it('uses the configured value, trimmed', () => {
    expect(resolveUserAgent('  MyClient/2.0  ')).toBe('MyClient/2.0');
    expect(userAgentHeader('MyClient/2.0')).toEqual({ 'User-Agent': 'MyClient/2.0' });
  });

  it('reads the environment at call time, not at module load', () => {
    delete process.env.WORDPRESS_USER_AGENT;
    expect(resolveUserAgent()).toBeUndefined();
    process.env.WORDPRESS_USER_AGENT = 'Set/Later';
    expect(resolveUserAgent()).toBe('Set/Later');
  });
});
