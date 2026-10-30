import { cartWriteSchema, emptyCart, replaceCart, type Cart } from '../shared/cart';
import { fixtureCartItems } from '../shared/fixtures/cart';
import { isFinished, type PromoRecord } from '../shared/promo';
import { newShareSettings, sharePath, shareSettingsSchema, shareUpdateSchema, shareUrl, shareView, type ShareSettings } from '../shared/share';
import { emptyUnbox, markOpened, openedIn, unboxStateSchema, unboxWriteSchema } from '../shared/unbox';
import { hasToken, isOwner, sameSecret, unauthorized } from './auth';
import type { Env } from './env';
import { invalidBody, json, readJson } from './http';
import { handleMcp } from './mcp';
import { promoApi } from './promo';
import { runnerApi } from './runner';
import { castPath, handleCast } from './cast';
import { DEFAULT_NICKNAME } from '../shared/share';
import { tools, type Store } from './tools';

const CART_KEY = 'cart';
const SHARE_KEY = 'share';
const UNBOX_KEY = 'unbox';
const LATEST_PROMO_KEY = 'promo:latest';
/** Ids of the jobs not yet done or failed, oldest first: what /runner/next takes from. */
const PROMO_QUEUE_KEY = 'promo:queue';
const promoKey = (id: string) => `promo:${id}`;

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

  private async storedShare() {
    const stored = await this.ctx.storage.get(SHARE_KEY);
    return stored === undefined ? undefined : shareSettingsSchema.parse(stored);
  }

  private store(): Store {
    const { storage } = this.ctx;
    return {
      cart: () => this.read(),
      saveCart: cart => storage.put(CART_KEY, cart),
      share: async () => {
        const stored = await this.storedShare();
        if (stored) return stored;
        const created = newShareSettings();
        await storage.put(SHARE_KEY, created);
        return created;
      },
      saveShare: settings => storage.put(SHARE_KEY, settings),
      promo: id => storage.get<PromoRecord>(promoKey(id)),
      async latestPromo() {
        const id = await storage.get<string>(LATEST_PROMO_KEY);
        return id ? storage.get<PromoRecord>(promoKey(id)) : undefined;
      },
      queuePromo: async record => {
        const queue = await storage.get<string[]>(PROMO_QUEUE_KEY) ?? [];
        await storage.put({ [promoKey(record.job.id)]: record, [LATEST_PROMO_KEY]: record.job.id, [PROMO_QUEUE_KEY]: [...queue, record.job.id] });
      },
      async promoQueue() {
        const records = await Promise.all((await storage.get<string[]>(PROMO_QUEUE_KEY) ?? []).map(id => storage.get<PromoRecord>(promoKey(id))));
        return records.filter(record => record !== undefined);
      },
      async savePromo(record) {
        const queue = await storage.get<string[]>(PROMO_QUEUE_KEY) ?? [];
        await storage.put({ [promoKey(record.job.id)]: record, [PROMO_QUEUE_KEY]: isFinished(record.job) ? queue.filter(id => id !== record.job.id) : queue });
      },
    };
  }

  /** What a visitor gets at `/s/<slug>`: the narrowed cart, or one 404 for a slug that is wrong, malformed, never made or switched off. */
  private async shared(request: Request, pathname: string) {
    if (request.method !== 'GET') return json({ error: 'method_not_allowed' }, 405, { allow: 'GET' });
    const sent = sharePath.exec(pathname)?.[1], settings = sent ? await this.storedShare() : undefined;
    if (!sent || !settings?.enabled || !sameSecret(sent, settings.slug)) return json({ error: 'not_found' }, 404);
    return json(shareView(await this.read(), settings));
  }

  private async share(request: Request) {
    if (request.method !== 'GET' && request.method !== 'PUT') return json({ error: 'method_not_allowed' }, 405, { allow: 'GET, PUT' });
    if (!isOwner(request, this.env)) return unauthorized();
    const store = this.store(), current = await store.share(), origin = new URL(request.url).origin;
    if (request.method === 'GET') return json({ ...current, url: shareUrl(origin, current.slug) });
    const sent = await readJson(request);
    if (!sent) return json({ error: 'invalid_json' }, 400);
    const parsed = shareUpdateSchema.safeParse(sent.body);
    if (!parsed.success) return invalidBody(parsed.error);
    const next: ShareSettings = { slug: current.slug, ...parsed.data };
    await store.saveShare(next);
    return json({ ...next, url: shareUrl(origin, next.slug) });
  }

  /** Which parcels the owner has opened: GET reads, POST marks more as opened. Only items still in the cart count. */
  private async unbox(request: Request) {
    if (request.method !== 'GET' && request.method !== 'POST') return json({ error: 'method_not_allowed' }, 405, { allow: 'GET, POST' });
    if (!isOwner(request, this.env)) return unauthorized();
    const [cart, stored] = await Promise.all([this.read(), this.ctx.storage.get(UNBOX_KEY)]);
    const current = stored === undefined ? emptyUnbox() : unboxStateSchema.parse(stored);
    if (request.method === 'GET') return json(openedIn(current, cart.items));
    const sent = await readJson(request);
    if (!sent) return json({ error: 'invalid_json' }, 400);
    const parsed = unboxWriteSchema.safeParse(sent.body);
    if (!parsed.success) return invalidBody(parsed.error);
    const next = markOpened(current, cart.items, parsed.data.itemIds, new Date().toISOString());
    if (JSON.stringify(next) !== JSON.stringify(current)) await this.ctx.storage.put(UNBOX_KEY, next);
    return json(next);
  }

  async fetch(request: Request): Promise<Response> {
    const { pathname } = new URL(request.url);
    if (pathname === '/mcp') return hasToken(request, this.env) ? handleMcp(request, tools, this.store()) : unauthorized();
    if (pathname.startsWith('/runner/')) return runnerApi(request, this.env, this.store(), pathname);
    if (pathname === '/api/promo') return promoApi(request, this.env, this.store());
    if (pathname.startsWith('/s/')) return this.shared(request, pathname);
    if (pathname === '/api/share') return this.share(request);
    if (pathname === '/api/unbox') return this.unbox(request);
    if (castPath.test(pathname)) return handleCast(request, { storage: this.ctx.storage, env: this.env, nickname: async () => (await this.storedShare())?.nickname ?? DEFAULT_NICKNAME });
    if (pathname !== '/api/cart') return json({ error: 'not_found' }, 404);
    if (request.method !== 'GET' && request.method !== 'POST') return json({ error: 'method_not_allowed' }, 405, { allow: 'GET, POST' });
    if (!isOwner(request, this.env)) return unauthorized();
    if (request.method === 'GET') return json(await this.read());
    const sent = await readJson(request);
    if (!sent) return json({ error: 'invalid_json' }, 400);
    const parsed = cartWriteSchema.safeParse(sent.body);
    if (!parsed.success) return invalidBody(parsed.error);
    const stored = await this.stored();
    const next = replaceCart(stored ?? emptyCart(), parsed.data.items, new Date().toISOString());
    // Unchanged items give back the stored cart itself; the first write is always kept, so the fixture never comes back.
    if (next !== stored) await this.ctx.storage.put(CART_KEY, next);
    return json(next);
  }
}
