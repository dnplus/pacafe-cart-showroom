export interface Env {
  SHOWROOM: DurableObjectNamespace;
  ASSETS: Fetcher;
  /** The owner's key: `/api/cart`, `/api/share` and every `/mcp` call send it as `Authorization: Bearer …`; set with `wrangler secret put CART_MCP_TOKEN`, never in a file. */
  CART_MCP_TOKEN?: string;
  /** "true" only in wrangler's env.local: anyone on this machine acts as the owner (reads and writes the cart and the share settings). `/mcp` still needs the token. */
  OPEN_OWNER_ACCESS?: string;
  /** "true" only in wrangler's env.local: a showroom that was never written starts with the five-item fixture. */
  SEED_FIXTURE?: string;
}
