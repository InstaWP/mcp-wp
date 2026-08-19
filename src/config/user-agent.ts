// src/config/user-agent.ts
//
// One place that decides the User-Agent for every outbound request this server
// makes — the WordPress REST client, the SQL endpoint, the two api.wordpress.org
// calls, and remote media downloads.
//
// The default is deliberately *no* User-Agent, so axios sends its own
// `axios/<version>`. That is what the package has always sent and what the edges
// in InstaWP/mcp-wp#28 let through; a bare `Mozilla/5.0` is a bot signature and
// gets a 403 challenge page. Set WORDPRESS_USER_AGENT only when a strict edge
// rejects the axios default.

/**
 * Resolve the configured User-Agent, or `undefined` to let axios use its default.
 * Reads WORDPRESS_USER_AGENT at call time so a test (or a client that sets the
 * variable late) is not fighting module load order.
 *
 * @param envValue Explicit value, for tests. Falls back to the environment.
 */
export function resolveUserAgent(envValue?: string): string | undefined {
  const raw = envValue ?? process.env.WORDPRESS_USER_AGENT;
  if (raw === undefined) return undefined;

  const trimmed = raw.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

/**
 * The User-Agent header to spread into an axios request config: either a
 * single-entry object, or an empty one so axios fills in its own default.
 * Spreading `{}` is what keeps "unset" distinct from "set to empty", which some
 * edges also block.
 */
export function userAgentHeader(envValue?: string): Record<string, string> {
  const ua = resolveUserAgent(envValue);
  return ua ? { 'User-Agent': ua } : {};
}
