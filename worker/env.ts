export interface Env {
  SHOWROOM: DurableObjectNamespace;
  ASSETS: Fetcher;
  /** Writers send it as `Authorization: Bearer …`; set with `wrangler secret put CART_MCP_TOKEN`, never in a file. */
  CART_MCP_TOKEN?: string;
  /** "true" only in wrangler's env.local: lets anyone on this machine write the cart. */
  ALLOW_OPEN_WRITES?: string;
  /** "true" only in wrangler's env.local: a showroom that was never written starts with the five-item fixture. */
  SEED_FIXTURE?: string;
}
