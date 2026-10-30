import type { Env } from './env';

/** Compares every byte, so a wrong token takes as long to refuse as a nearly right one. */
export function sameSecret(sent: string, secret: string) {
  const a = new TextEncoder().encode(sent), b = new TextEncoder().encode(secret);
  let diff = a.length ^ b.length;
  for (let i = 0; i < Math.max(a.length, b.length); i++) diff |= (a[i] ?? 0) ^ (b[i] ?? 0);
  return diff === 0;
}

export function hasToken(request: Request, env: Env) {
  const sent = /^Bearer\s+(\S+)$/i.exec(request.headers.get('authorization') ?? '')?.[1];
  return Boolean(env.CART_MCP_TOKEN && sent && sameSecret(sent, env.CART_MCP_TOKEN));
}
/** The owner reads and writes the cart and the share settings; env.local lets anyone on the machine be the owner. */
export const isOwner = (request: Request, env: Env) => env.OPEN_OWNER_ACCESS === 'true' || hasToken(request, env);
export const unauthorized = () => Response.json({ error: 'unauthorized' }, { status: 401, headers: { 'cache-control': 'no-store', 'www-authenticate': 'Bearer' } });
