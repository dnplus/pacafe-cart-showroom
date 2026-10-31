export interface Env {
  SHOWROOM: DurableObjectNamespace;
  ASSETS: Fetcher;
  /** Promo videos under `promo/<jobId>/`, the owner's generated sprite under `owner/`; see worker/media.ts for who reads what. */
  MEDIA: R2Bucket;
  /** Meta Model API key and base URL (with its /v1 path), both secrets; unset, nothing calls the API and the owner's sprite button says what it needs. */
  META_API_KEY?: string;
  META_API_BASE_URL?: string;
  /** The built-in clerk's daily spend on META_API_KEY in US dollars (default 2); past it the owner is asked for their own key. */
  CLERK_DAILY_USD?: string;
  /** The owner's key: `/api/cart`, `/api/share` and every `/mcp` call send it as `Authorization: Bearer …`; set with `wrangler secret put CART_MCP_TOKEN`, never in a file. */
  CART_MCP_TOKEN?: string;
  /** "true" only in wrangler's env.local: anyone on this machine acts as the owner (reads and writes the cart and the share settings). `/mcp` still needs the token. */
  OPEN_OWNER_ACCESS?: string;
  /** "true" only in wrangler's env.local: a showroom that was never written starts with the five-item fixture. */
  SEED_FIXTURE?: string;
}
