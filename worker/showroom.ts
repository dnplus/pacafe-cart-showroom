import { cartWriteSchema, emptyCart, replaceCart, type Cart } from '../shared/cart';
import { fixtureCartItems } from '../shared/fixtures/cart';
import type { Env } from './env';

const CART_KEY = 'cart';
const json = (body: unknown, status = 200, headers: Record<string, string> = {}) => Response.json(body, { status, headers: { 'cache-control': 'no-store', ...headers } });

/** Compares every byte, so a wrong token takes as long to refuse as a nearly right one. */
function sameSecret(sent: string, secret: string) {
  const a = new TextEncoder().encode(sent), b = new TextEncoder().encode(secret);
  let diff = a.length ^ b.length;
  for (let i = 0; i < Math.max(a.length, b.length); i++) diff |= (a[i] ?? 0) ^ (b[i] ?? 0);
  return diff === 0;
}

function mayWrite(request: Request, env: Env) {
  if (env.ALLOW_OPEN_WRITES === 'true') return true;
  const sent = /^Bearer\s+(\S+)$/i.exec(request.headers.get('authorization') ?? '')?.[1];
  return Boolean(env.CART_MCP_TOKEN && sent && sameSecret(sent, env.CART_MCP_TOKEN));
}

/** The one showroom: its cart lives in this object's storage under a single key. */
export class Showroom {
  constructor(private readonly ctx: DurableObjectState, private readonly env: Env) {}

  private stored() { return this.ctx.storage.get<Cart>(CART_KEY); }

  /** The cart as stored; a showroom never written shows the fixture where env.local asks for it, and keeps it. */
  private async read(): Promise<Cart> {
    const cart = await this.stored();
    if (cart) return cart;
    if (this.env.SEED_FIXTURE !== 'true') return emptyCart();
    const seeded = replaceCart(emptyCart(), fixtureCartItems, new Date().toISOString());
    await this.ctx.storage.put(CART_KEY, seeded);
    return seeded;
  }

  async fetch(request: Request): Promise<Response> {
    if (request.method === 'GET') return json(await this.read());
    if (request.method !== 'POST') return json({ error: 'method_not_allowed' }, 405, { allow: 'GET, POST' });
    if (!mayWrite(request, this.env)) return json({ error: 'unauthorized' }, 401, { 'www-authenticate': 'Bearer' });
    let body: unknown;
    try { body = await request.json(); } catch { return json({ error: 'invalid_json' }, 400); }
    const parsed = cartWriteSchema.safeParse(body);
    if (!parsed.success) return json({ error: 'invalid_body', issues: parsed.error.issues.map(issue => ({ path: issue.path.join('.'), message: issue.message })) }, 400);
    const stored = await this.stored();
    const next = replaceCart(stored ?? emptyCart(), parsed.data.items, new Date().toISOString());
    // Unchanged items give back the stored cart itself; the first write is always kept, so the fixture never comes back.
    if (next !== stored) await this.ctx.storage.put(CART_KEY, next);
    return json(next);
  }
}
