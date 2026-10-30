import { describe, expect, it } from 'vitest';
import { cartSchema, type CartItemInput } from '../shared/cart';
import { newShareSettings, priceRange, publicLink, shareSettingsSchema, shareViewSchema } from '../shared/share';
import type { Env } from '../worker/env';
import worker from '../worker/index';
import { Showroom } from '../worker/showroom';
import { memoryState } from './memory-state';

const token = 'test-token-0123456789';
const origin = 'https://showroom.test';
const owner = { authorization: `Bearer ${token}` };
const appPage = '<!doctype html><html><head><meta charset="UTF-8"/><title>小屋購物車</title></head><body><div id="root"></div></body></html>';
const trackedLink = 'https://user:pw@shop.example/p/1?ref=abc&uid=42#frag';
/** Prices and a total (420×2 + 1290 = 2130) that are not bucket bounds, so a range view cannot contain them by accident. */
const items: CartItemInput[] = [
  { title: '陶瓷馬克杯', store: '小島陶房', url: trackedLink, priceTwd: 420, imageUrl: 'https://img.example/mug.jpg', qty: 2 },
  { title: '亞麻餐墊', store: '巷口布作', priceTwd: 1290, qty: 1 },
  { title: '試用包', qty: 3 },
];
const exactAmounts = [420, 1290, 2130];

/** The real worker over one real Showroom held in memory, with the production gate: a token and no open owner access. */
function world() {
  const state = memoryState(), assets: string[] = [];
  const env = { CART_MCP_TOKEN: token, SHOWROOM: { idFromName: (name: string) => name, get: () => new Showroom(state, env) },
    ASSETS: { fetch: async (request: Request) => { assets.push(new URL(request.url).pathname); return new Response(appPage, { headers: { 'content-type': 'text/html' } }); } } } as unknown as Env;
  const send = (path: string, init?: RequestInit) => worker.fetch(new Request(`${origin}${path}`, init) as Parameters<typeof worker.fetch>[0], env);
  const json = async (path: string, init?: RequestInit) => { const response = await send(path, init); return { response, body: await response.json() as any }; };
  const writeCart = () => send('/api/cart', { method: 'POST', headers: { ...owner, 'content-type': 'application/json' }, body: JSON.stringify({ items }) });
  const settle = async (body: unknown) => json('/api/share', { method: 'PUT', headers: { ...owner, 'content-type': 'application/json' }, body: JSON.stringify(body) });
  const visit = (path: string, accept = 'application/json') => send(path, { headers: { accept } });
  return { send, json, writeCart, settle, visit, assets };
}

const keysOf = (value: unknown): string[] => Array.isArray(value) ? value.flatMap(keysOf) : value && typeof value === 'object' ? Object.entries(value).flatMap(([key, inner]) => [key, ...keysOf(inner)]) : [];
const hasNumber = (text: string, amount: number) => new RegExp(`(?<!\\d)${amount}(?!\\d)`).test(text);

describe('share settings', () => {
  it('start disabled with hidden prices, and an S2 record reads the same way', () => {
    const created = newShareSettings();
    expect(created).toMatchObject({ enabled: false, prices: 'hidden', nickname: '屋主' });
    expect(shareSettingsSchema.parse({ slug: created.slug, enabled: true })).toEqual({ slug: created.slug, enabled: true, prices: 'hidden', nickname: '屋主' });
  });

  it('get a 22-character base64url slug from fresh randomness each time', () => {
    const slugs = Array.from({ length: 1000 }, () => newShareSettings().slug);
    for (const slug of slugs) expect(slug).toMatch(/^[A-Za-z0-9_-]{22}$/);
    expect(new Set(slugs).size).toBe(1000);
    expect(new Set(slugs.join('')).size).toBeGreaterThanOrEqual(60);
  });
});

describe('the narrowing', () => {
  it('strips the query, fragment and credentials from a product link and keeps its path', () => {
    expect(publicLink(trackedLink)).toBe('https://shop.example/p/1');
    expect(publicLink('https://shop.example/a/b/c')).toBe('https://shop.example/a/b/c');
    expect(publicLink(null)).toBeNull();
  });

  it('puts an amount in the bucket at or below it, open-ended past the last step', () => {
    expect(priceRange(0)).toEqual({ minTwd: 0, maxTwd: 100 });
    expect(priceRange(100)).toEqual({ minTwd: 100, maxTwd: 300 });
    expect(priceRange(420)).toEqual({ minTwd: 300, maxTwd: 500 });
    expect(priceRange(2130)).toEqual({ minTwd: 1000, maxTwd: 3000 });
    expect(priceRange(100_000)).toEqual({ minTwd: 100_000, maxTwd: null });
    expect(priceRange(2_500_000)).toEqual({ minTwd: 100_000, maxTwd: null });
  });
});

describe('/api/cart and /api/share', () => {
  it('answer only the owner', async () => {
    const { send, writeCart } = world();
    expect((await writeCart()).status).toBe(200);
    expect((await send('/api/cart')).status).toBe(401);
    expect((await send('/api/cart')).headers.get('www-authenticate')).toBe('Bearer');
    expect((await send('/api/cart', { headers: { authorization: 'Bearer test-token-0123456780' } })).status).toBe(401);
    expect((await send('/api/cart', { headers: owner })).status).toBe(200);
    expect((await send('/api/share')).status).toBe(401);
    expect((await send('/api/share', { method: 'PUT', body: JSON.stringify({ enabled: true, prices: 'exact', nickname: 'x' }) })).status).toBe(401);
  });

  it('create the settings on first ask and take only a full, valid update', async () => {
    const { json, settle } = world();
    const first = (await json('/api/share', { headers: owner })).body;
    expect(first).toEqual({ slug: expect.stringMatching(/^[A-Za-z0-9_-]{22}$/), enabled: false, prices: 'hidden', nickname: '屋主', url: `${origin}/s/${first.slug}` });
    for (const bad of [{ enabled: true }, { enabled: true, prices: 'all', nickname: 'a' }, { enabled: true, prices: 'range', nickname: '   ' }, { enabled: true, prices: 'range', nickname: 'x'.repeat(25) }, { enabled: true, prices: 'range', nickname: 'a', slug: 'A'.repeat(22) }]) {
      expect((await settle(bad)).response.status).toBe(400);
    }
    const saved = await settle({ enabled: true, prices: 'range', nickname: '  小島  ' });
    expect(saved.body).toEqual({ ...first, enabled: true, prices: 'range', nickname: '小島' });
    expect((await json('/api/share', { headers: owner })).body).toEqual(saved.body);
    expect((await json('/api/share', { method: 'DELETE', headers: owner })).response.status).toBe(405);
  });
});

describe('/s/<slug>', () => {
  it('gives one 404 for a link never made, switched off, wrong or malformed', async () => {
    const { json, settle, visit, writeCart } = world();
    await writeCart();
    const never = await visit(`/s/${'A'.repeat(22)}`);
    expect(never.status).toBe(404);
    const body = await never.text(), page = await (await visit(`/s/${'A'.repeat(22)}`, 'text/html')).text();
    expect(JSON.parse(body)).toEqual({ error: 'not_found' });
    const { slug } = (await json('/api/share', { headers: owner })).body;
    const answers = async () => Promise.all([`/s/${slug}`, `/s/${'B'.repeat(22)}`, `/s/${slug.slice(1)}`, `/s/${slug}x`, `/s/${slug}/more`, '/s/'].flatMap(path => [visit(path), visit(path, 'text/html')]));
    const off = await answers();
    expect(off.map(response => response.status)).toEqual(off.map(() => 404));
    expect(await Promise.all(off.map(response => response.text()))).toEqual(off.map((_, n) => n % 2 ? page : body));
    await settle({ enabled: true, prices: 'hidden', nickname: '屋主' });
    const on = await answers();
    expect(on.slice(0, 2).map(response => response.status)).toEqual([200, 200]);
    expect(await Promise.all(on.slice(2).map(response => response.text()))).toEqual(on.slice(2).map((_, n) => n % 2 ? page : body));
    expect(page).toContain('這個分享連結不存在或已關閉');
  });

  it('shows no price at all by default', async () => {
    const { json, settle, visit, writeCart } = world();
    await writeCart();
    const { slug } = (await json('/api/share', { headers: owner })).body;
    await settle({ enabled: true, prices: 'hidden', nickname: '屋主' });
    const text = await (await visit(`/s/${slug}`)).text(), view = JSON.parse(text);
    expect(shareViewSchema.parse(view).prices).toBe('hidden');
    expect(Object.keys(view).sort()).toEqual(['items', 'nickname', 'prices']);
    expect(keysOf(view.items).filter(key => /price|total/i.test(key))).toEqual([]);
    expect(keysOf(view).filter(key => /price|total/i.test(key))).toEqual(['prices']);
    for (const amount of exactAmounts) expect(hasNumber(text, amount)).toBe(false);
    expect(view.items.map((item: { title: string; qty: number }) => [item.title, item.qty])).toEqual([['陶瓷馬克杯', 2], ['亞麻餐墊', 1], ['試用包', 3]]);
  });

  it('shows buckets in range mode and never the amounts', async () => {
    const { json, settle, visit, writeCart } = world();
    await writeCart();
    const { slug } = (await json('/api/share', { headers: owner })).body;
    await settle({ enabled: true, prices: 'range', nickname: '屋主' });
    const text = await (await visit(`/s/${slug}`)).text(), view = shareViewSchema.parse(JSON.parse(text));
    expect(view).toMatchObject({ prices: 'range', totalRange: { minTwd: 1000, maxTwd: 3000 } });
    expect(view.items.map(item => 'priceRange' in item && item.priceRange)).toEqual([{ minTwd: 300, maxTwd: 500 }, { minTwd: 1000, maxTwd: 3000 }, null]);
    expect(keysOf(JSON.parse(text)).filter(key => /price|total/i.test(key)).sort()).toEqual(['priceRange', 'priceRange', 'priceRange', 'prices', 'totalRange']);
    for (const amount of exactAmounts) expect(hasNumber(text, amount)).toBe(false);
  });

  it('shows the exact prices and total in exact mode', async () => {
    const { json, settle, visit, writeCart } = world();
    const cart = cartSchema.parse(await (await writeCart()).json());
    const { slug } = (await json('/api/share', { headers: owner })).body;
    await settle({ enabled: true, prices: 'exact', nickname: '屋主' });
    const view = shareViewSchema.parse(await (await visit(`/s/${slug}`)).json());
    expect(view.prices === 'exact' && view.items.map(item => item.priceTwd)).toEqual(cart.items.map(item => item.priceTwd));
    expect(view.prices === 'exact' && view.totalTwd).toBe(cart.totalTwd);
  });

  it('hands out product links without query, fragment or credentials, and nothing that names the owner\'s items', async () => {
    const { json, settle, visit, writeCart } = world();
    const cart = cartSchema.parse(await (await writeCart()).json());
    const { slug } = (await json('/api/share', { headers: owner })).body;
    for (const prices of ['hidden', 'range', 'exact']) {
      await settle({ enabled: true, prices, nickname: '屋主' });
      const text = await (await visit(`/s/${slug}`)).text(), view = JSON.parse(text);
      expect(view.items[0].url).toBe('https://shop.example/p/1');
      expect(view.items[1].url).toBeNull();
      for (const leak of ['ref=abc', 'uid=42', 'frag', 'user:pw', 'pw@', '小島陶房', '巷口布作', ...cart.items.map(item => item.id), cart.updatedAt]) expect(text).not.toContain(leak);
      expect(keysOf(view).filter(key => /^(id|store|revision|updatedAt|addedAt|shelfSlot|cutoutUrl|fill)$/.test(key))).toEqual([]);
    }
  });

  it('opens as the app named for the owner, with no price, for a browser', async () => {
    const { json, settle, visit, writeCart, assets } = world();
    await writeCart();
    const { slug } = (await json('/api/share', { headers: owner })).body;
    await settle({ enabled: true, prices: 'exact', nickname: '<小島>&"家"' });
    const page = await visit(`/s/${slug}`, 'text/html,application/xhtml+xml');
    expect(page.status).toBe(200);
    expect(page.headers.get('content-type')).toMatch(/^text\/html/);
    for (const [name, value] of [['referrer-policy', 'no-referrer'], ['cache-control', 'no-store'], ['vary', 'accept'], ['x-robots-tag', 'noindex']]) expect(page.headers.get(name)).toBe(value);
    const html = await page.text();
    expect(html).toContain('<meta property="og:title" content="&#60;小島&#62;&#38;&#34;家&#34; 的小屋購物車"/>');
    expect(html).toContain('<title>&#60;小島&#62;&#38;&#34;家&#34; 的小屋購物車</title>');
    expect(html).toContain('<meta property="og:description" content="3 件東西"/>');
    expect(html).toContain('<meta name="robots" content="noindex"/>');
    expect(html).not.toContain('<小島>');
    for (const amount of exactAmounts) expect(hasNumber(html, amount)).toBe(false);
    expect(html).not.toContain('NT$');
    expect(assets).toEqual(['/']);
    const data = await visit(`/s/${slug}`);
    for (const name of ['referrer-policy', 'cache-control', 'vary', 'x-robots-tag']) expect(data.headers.get(name)).toBe(page.headers.get(name));
  });

  it('takes only GET', async () => {
    const { json, settle, send, writeCart } = world();
    await writeCart();
    const { slug } = (await json('/api/share', { headers: owner })).body;
    await settle({ enabled: true, prices: 'range', nickname: '屋主' });
    for (const accept of ['application/json', 'text/html']) {
      const posted = await send(`/s/${slug}`, { method: 'POST', headers: { accept } });
      expect(posted.status).toBe(405);
      expect(posted.headers.get('allow')).toBe('GET');
    }
  });

  it('closes again when the owner turns sharing off', async () => {
    const { json, settle, visit, writeCart } = world();
    await writeCart();
    const { slug } = (await json('/api/share', { headers: owner })).body;
    await settle({ enabled: true, prices: 'exact', nickname: '屋主' });
    expect((await visit(`/s/${slug}`)).status).toBe(200);
    await settle({ enabled: false, prices: 'exact', nickname: '屋主' });
    expect((await visit(`/s/${slug}`)).status).toBe(404);
    expect((await visit(`/s/${slug}`, 'text/html')).status).toBe(404);
  });

  it('shows in cart_list over /mcp with the price mode', async () => {
    const { json, settle, writeCart } = world();
    await writeCart();
    await settle({ enabled: true, prices: 'range', nickname: '屋主' });
    const { body } = await json('/mcp', { method: 'POST', headers: { ...owner, 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'cart_list', arguments: {} } }) });
    const { share, items: listed } = body.result.structuredContent;
    const { slug } = (await json('/api/share', { headers: owner })).body;
    expect(share).toEqual({ url: `${origin}/s/${slug}`, enabled: true, prices: 'range' });
    expect(listed).toHaveLength(3);
  });
});
