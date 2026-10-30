import { describe, expect, it } from 'vitest';
import { cartSchema, type Cart } from '../shared/cart';
import { fixtureCartItems } from '../shared/fixtures/cart';
import type { Env } from '../worker/env';
import { Showroom } from '../worker/showroom';
import worker from '../worker/index';

/** Durable Object storage as the KV API shows it: values come back as copies, as they do from the real store. */
function memoryState() {
  const data = new Map<string, unknown>();
  const storage = { async get(key: string) { return structuredClone(data.get(key)); }, async put(key: string, value: unknown) { data.set(key, structuredClone(value)); } };
  return { storage } as unknown as DurableObjectState;
}
const env = (vars: Partial<Env> = {}) => vars as Env;
const url = 'https://showroom.test/api/cart';
const get = (room: Showroom) => room.fetch(new Request(url));
const post = (room: Showroom, body: unknown, token?: string) => room.fetch(new Request(url, { method: 'POST', body: typeof body === 'string' ? body : JSON.stringify(body), headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) } }));
const cartOf = async (response: Response) => cartSchema.parse(await response.json());
const secret = { CART_MCP_TOKEN: 'test-token-0123456789' };

describe('Showroom', () => {
  it('keeps a written cart for the next object over the same storage', async () => {
    const state = memoryState();
    const written = await post(new Showroom(state, env(secret)), { items: fixtureCartItems }, secret.CART_MCP_TOKEN);
    expect(written.status).toBe(200);
    const saved = await cartOf(written);
    const reread = await get(new Showroom(state, env(secret)));
    expect(await cartOf(reread)).toEqual(saved);
    expect(saved.items.map(item => item.title)).toEqual(fixtureCartItems.map(item => item.title));
    expect(saved.totalTwd).toBe(7460);
  });

  it('refuses writes without the token, or with a wrong one', async () => {
    const state = memoryState(), room = new Showroom(state, env(secret));
    expect((await post(room, { items: fixtureCartItems })).status).toBe(401);
    expect((await post(room, { items: fixtureCartItems }, 'test-token-0123456780')).status).toBe(401);
    expect((await cartOf(await get(room))).items).toEqual([]);
  });

  it('refuses writes when no token is configured at all', async () => {
    expect((await post(new Showroom(memoryState(), env()), { items: [] }, 'anything')).status).toBe(401);
  });

  it('lets anyone write where env.local opens writes', async () => {
    const response = await post(new Showroom(memoryState(), env({ ALLOW_OPEN_WRITES: 'true' })), { items: [{ title: 'pen', priceTwd: 25 }] });
    expect(response.status).toBe(200);
    expect((await cartOf(response)).totalTwd).toBe(25);
  });

  it('refuses a body that is not a cart write', async () => {
    const room = new Showroom(memoryState(), env(secret));
    expect((await post(room, '{not json', secret.CART_MCP_TOKEN)).status).toBe(400);
    expect((await post(room, { items: [{ priceTwd: 100 }] }, secret.CART_MCP_TOKEN)).status).toBe(400);
    expect((await post(room, { items: [{ title: 'pen', priceTwd: -1 }] }, secret.CART_MCP_TOKEN)).status).toBe(400);
    expect((await cartOf(await get(room))).revision).toBe(0);
  });

  it('starts with the fixture only when the showroom was never written', async () => {
    const seeded = memoryState(), local = env({ SEED_FIXTURE: 'true', ALLOW_OPEN_WRITES: 'true' });
    expect((await cartOf(await get(new Showroom(seeded, local)))).items).toHaveLength(5);
    const emptied = memoryState();
    await post(new Showroom(emptied, local), { items: [] });
    expect((await cartOf(await get(new Showroom(emptied, local)))).items).toEqual([]);
    expect((await cartOf(await get(new Showroom(memoryState(), env())))).items).toEqual([]);
  });

  it('gives back the same revision when the same cart is written twice', async () => {
    const room = new Showroom(memoryState(), env(secret));
    const first = await cartOf(await post(room, { items: fixtureCartItems }, secret.CART_MCP_TOKEN));
    const second = await cartOf(await post(room, { items: fixtureCartItems }, secret.CART_MCP_TOKEN));
    expect(second).toEqual(first);
  });
});

describe('worker', () => {
  it('sends /api/cart to the default showroom and every other path to the app', async () => {
    const asked: string[] = [];
    const fake: Env = {
      SHOWROOM: { idFromName: (name: string) => { asked.push(`id:${name}`); return name; }, get: (id: string) => ({ fetch: async () => { asked.push(`room:${id}`); return Response.json({} as Cart); } }) } as unknown as DurableObjectNamespace,
      ASSETS: { fetch: async () => { asked.push('assets'); return new Response('app'); } } as unknown as Fetcher,
    };
    const run = (path: string) => worker.fetch(new Request(`https://showroom.test${path}`) as Parameters<typeof worker.fetch>[0], fake);
    await run('/api/cart'); await run('/'); await run('/some/page');
    expect(asked).toEqual(['id:default', 'room:default', 'assets', 'assets']);
    expect((await run('/api/other')).status).toBe(404);
  });
});
