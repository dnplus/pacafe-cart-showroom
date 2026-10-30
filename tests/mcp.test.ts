import { describe, expect, it } from 'vitest';
import { cartSchema, MAX_CART_ITEMS } from '../shared/cart';
import { promoJobSchema } from '../shared/promo';
import type { Env } from '../worker/env';
import worker from '../worker/index';
import { Showroom } from '../worker/showroom';
import { memoryState } from './memory-state';

const token = 'test-token-0123456789';
const origin = 'https://showroom.test';
const bodyOf = async (response: Response) => await response.json() as any;

/** A worker over one real Showroom whose storage lives in memory, so the whole path runs through the real handlers. */
function world(vars: Partial<Env> = { CART_MCP_TOKEN: token }) {
  const state = memoryState();
  const env = { ...vars, SHOWROOM: { idFromName: (name: string) => name, get: () => new Showroom(state, env) }, ASSETS: { fetch: async () => new Response('app') } } as unknown as Env;
  const send = (path: string, init?: RequestInit) => worker.fetch(new Request(`${origin}${path}`, init) as Parameters<typeof worker.fetch>[0], env);
  const post = (body: unknown, headers: Record<string, string> = { authorization: `Bearer ${token}` }) => send('/mcp', { method: 'POST', body: typeof body === 'string' ? body : JSON.stringify(body), headers: { 'content-type': 'application/json', ...headers } });
  let nextId = 1;
  const rpc = async (method: string, params?: unknown, headers?: Record<string, string>) => {
    const response = await post({ jsonrpc: '2.0', id: nextId++, method, params }, headers ?? { authorization: `Bearer ${token}` });
    return { response, body: await bodyOf(response) };
  };
  const call = async (name: string, args: unknown = {}) => (await rpc('tools/call', { name, arguments: args })).body.result;
  return { send, post, rpc, call };
}

describe('/mcp', () => {
  it('lets an agent record purchases, get the share link and queue and poll an intro video', async () => {
    const { rpc, call, send } = world();
    const init = await rpc('initialize', { protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 'test', version: '0' } });
    expect(init.body.result).toMatchObject({ protocolVersion: '2025-11-25', capabilities: { tools: { listChanged: false } }, serverInfo: { name: 'muse-cart-showroom', version: '0.2.0' } });
    expect(init.response.headers.get('mcp-session-id')).toBeNull();

    const listed = (await rpc('tools/list')).body.result.tools as { name: string; annotations: { readOnlyHint: boolean }; inputSchema: Record<string, unknown> }[];
    expect(listed.map(tool => tool.name).sort()).toEqual(['cart_add', 'cart_list', 'cart_remove', 'promo_generate', 'promo_status']);
    expect(listed.filter(tool => tool.annotations.readOnlyHint).map(tool => tool.name).sort()).toEqual(['cart_list', 'promo_status']);
    expect(listed.find(tool => tool.name === 'cart_add')!.inputSchema).toMatchObject({ type: 'object', required: ['title'] });
    expect(listed.every(tool => !('$schema' in tool.inputSchema))).toBe(true);

    await call('cart_add', { title: '陶瓷馬克杯', store: '小島陶房', priceTwd: 420, qty: 2 });
    const added = await call('cart_add', { title: '亞麻餐墊', priceTwd: 290 });
    expect(added.isError).toBe(false);
    expect(cartSchema.parse(added.structuredContent).items).toHaveLength(2);
    expect(JSON.parse(added.content[0].text)).toEqual(added.structuredContent);

    const listing = (await call('cart_list')).structuredContent;
    const { share, ...cart } = listing;
    expect(cartSchema.parse(cart)).toMatchObject({ totalTwd: 420 * 2 + 290 });
    expect(listing.items.map((item: { title: string }) => item.title)).toEqual(['陶瓷馬克杯', '亞麻餐墊']);
    expect(share.url).toMatch(/^https:\/\/showroom\.test\/s\/[A-Za-z0-9_-]{22}$/);
    expect(share.enabled).toBe(false);

    const removed = await call('cart_remove', { itemId: listing.items[1].id });
    expect(removed.structuredContent.items.map((item: { title: string }) => item.title)).toEqual(['陶瓷馬克杯']);

    const queued = (await call('promo_generate', { style: '溫暖' })).structuredContent;
    expect(queued).toEqual({ jobId: expect.stringMatching(/^promo-/), status: 'queued' });
    const job = promoJobSchema.parse((await call('promo_status', { jobId: queued.jobId })).structuredContent);
    expect(job).toMatchObject({ id: queued.jobId, status: 'queued', progress: 0, cartRevision: removed.structuredContent.revision, durationSec: 30, style: '溫暖', output: null });

    const api = cartSchema.parse(await (await send('/api/cart')).json());
    expect(api).toEqual(removed.structuredContent);
  });

  it('refuses a call without the right token, even where env.local opens cart writes', async () => {
    const asked = { jsonrpc: '2.0', id: 1, method: 'ping' };
    for (const [vars, headers] of [
      [{ CART_MCP_TOKEN: token }, {}],
      [{ CART_MCP_TOKEN: token }, { authorization: 'Bearer test-token-0123456780' }],
      [{}, { authorization: `Bearer ${token}` }],
      [{ ALLOW_OPEN_WRITES: 'true' }, {}],
    ] as [Partial<Env>, Record<string, string>][]) {
      const response = await world(vars).post(asked, headers);
      expect(response.status).toBe(401);
      expect(response.headers.get('www-authenticate')).toBe('Bearer');
      expect(await response.json()).toEqual({ error: 'unauthorized' });
    }
  });

  it('answers with the protocol version the client asked for when it is supported, else the newest', async () => {
    const { rpc } = world();
    expect((await rpc('initialize', { protocolVersion: '2025-06-18' })).body.result.protocolVersion).toBe('2025-06-18');
    expect((await rpc('initialize', { protocolVersion: '1999-01-01' })).body.result.protocolVersion).toBe('2025-11-25');
  });

  it('refuses an unsupported MCP-Protocol-Version header', async () => {
    const { rpc } = world();
    const { response, body } = await rpc('ping', {}, { authorization: `Bearer ${token}`, 'mcp-protocol-version': '1999-01-01' });
    expect(response.status).toBe(400);
    expect(body.error.code).toBe(-32600);
    expect((await rpc('ping', {}, { authorization: `Bearer ${token}`, 'mcp-protocol-version': '2025-06-18' })).response.status).toBe(200);
  });

  it('takes a notification without a reply body, and only POST', async () => {
    const { post, send } = world();
    const notified = await post({ jsonrpc: '2.0', method: 'notifications/initialized' });
    expect(notified.status).toBe(202);
    expect(await notified.text()).toBe('');
    const got = await send('/mcp', { headers: { authorization: `Bearer ${token}` } });
    expect(got.status).toBe(405);
    expect(got.headers.get('allow')).toBe('POST');
  });

  it('refuses malformed, batched, oversized and unknown requests with JSON-RPC errors', async () => {
    const { post, rpc } = world();
    expect((await bodyOf(await post('{not json'))).error.code).toBe(-32700);
    expect((await bodyOf(await post([{ jsonrpc: '2.0', id: 1, method: 'ping' }]))).error.code).toBe(-32600);
    expect((await bodyOf(await post({ id: 1, method: 'ping' }))).error.code).toBe(-32600);
    const big = await post(JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'ping', params: { pad: 'x'.repeat(70 * 1024) } }));
    expect(big.status).toBe(413);
    expect((await rpc('resources/list')).body.error.code).toBe(-32601);
    const unknown = await rpc('tools/call', { name: 'checkout', arguments: {} });
    expect(unknown.body.error.code).toBe(-32602);
  });

  it('hands bad arguments back as a failed tool result the model can correct', async () => {
    const { call } = world();
    for (const [name, args, path] of [['promo_generate', { durationSec: 60 }, 'durationSec'], ['cart_add', { priceTwd: 10 }, 'title'], ['cart_add', { title: 'pen', extra: 1 }, 'extra']] as const) {
      const result = await call(name, args);
      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain(path);
    }
  });

  it('keeps the cart as it is when a tool refuses', async () => {
    const { call } = world();
    const empty = await call('promo_generate');
    expect(empty.isError).toBe(true);
    expect(empty.content[0].text).toContain('購物車是空的');
    await call('cart_add', { title: 'pen' });
    const missing = await call('cart_remove', { itemId: 'item-nope-0' });
    expect(missing.isError).toBe(true);
    expect((await call('cart_list')).structuredContent.items).toHaveLength(1);
    for (const jobId of ['promo-nope', 'latest', '00000000-0000-4000-8000-000000000000', 'promo-00000000-0000-4000-8000-000000000000']) expect((await call('promo_status', { jobId })).isError).toBe(true);
  });

  it('refuses an item past the largest cart', async () => {
    const { call } = world();
    for (let n = 0; n < MAX_CART_ITEMS; n++) expect((await call('cart_add', { title: `thing ${n}` })).isError).toBe(false);
    expect((await call('cart_add', { title: 'one too many' })).isError).toBe(true);
    expect((await call('cart_add', { title: 'thing 0', qty: 2 })).structuredContent.items[0].qty).toBe(3);
  });

  it('queues one job for a repeated request and a new one once the cart or the request changes', async () => {
    const { call } = world();
    await call('cart_add', { title: 'pen' });
    const first = (await call('promo_generate')).structuredContent.jobId;
    expect((await call('promo_generate', { durationSec: 30 })).structuredContent.jobId).toBe(first);
    const longer = (await call('promo_generate', { durationSec: 45 })).structuredContent.jobId;
    expect(longer).not.toBe(first);
    await call('cart_add', { title: 'cup' });
    const changed = (await call('promo_generate', { durationSec: 45 })).structuredContent.jobId;
    expect(changed).not.toBe(longer);
    expect((await call('promo_status', { jobId: first })).structuredContent.status).toBe('queued');
  });

  it('keeps one share slug per showroom', async () => {
    const [a, b] = [world(), world()];
    const slug = async (room: typeof a) => (await room.call('cart_list')).structuredContent.share.url;
    const first = await slug(a);
    expect(await slug(a)).toBe(first);
    expect(await slug(b)).not.toBe(first);
  });
});
