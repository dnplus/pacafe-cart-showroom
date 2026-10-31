import { afterEach, describe, expect, it, vi } from 'vitest';
import { chooseKey, CLERK_LIMITS, emptyClerkState } from '../shared/clerk';
import type { Env } from '../worker/env';
import worker from '../worker/index';
import { Showroom } from '../worker/showroom';
import { memoryState } from './memory-state';

const origin = 'https://showroom.test';
const HOUSE = 'house-key-0000-1111', OWN = 'own-key-2222-9876';
const base = 'https://model.test/v1';

type Reply = { content?: string; calls?: { name: string; args: unknown }[]; usage?: { prompt_tokens: number; completion_tokens: number } };
function fakeModel(replies: Reply[]) {
  const requests: { url: string; key: string | null; body: any }[] = [];
  const fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (!url.startsWith(base)) return new Response('not here', { status: 404 });
    requests.push({ url, key: new Headers(init?.headers).get('authorization'), body: JSON.parse(String(init?.body)) });
    const reply = replies.shift() ?? { content: 'done' };
    return Response.json({
      choices: [{ message: { content: reply.content ?? null, tool_calls: reply.calls?.map((call, i) => ({ id: `call-${requests.length}-${i}`, type: 'function', function: { name: call.name, arguments: JSON.stringify(call.args) } })) } }],
      usage: reply.usage ?? { prompt_tokens: 1000, completion_tokens: 100 },
    });
  });
  vi.stubGlobal('fetch', fetch);
  return { requests, fetch };
}

function world(vars: Partial<Env> = {}) {
  const state = memoryState();
  const env = { OPEN_OWNER_ACCESS: 'true', SEED_FIXTURE: 'true', META_API_KEY: HOUSE, META_API_BASE_URL: base, ...vars, SHOWROOM: { idFromName: (name: string) => name, get: () => (room ??= new Showroom(state, env)) }, ASSETS: { fetch: async () => new Response('app') } } as unknown as Env;
  let room: Showroom | undefined;
  const send = async (path: string, init?: RequestInit) => { const response = await worker.fetch(new Request(`${origin}${path}`, init) as Parameters<typeof worker.fetch>[0], env); return { status: response.status, body: await response.json() as any }; };
  const say = (message: string, language = 'en') => send('/api/clerk', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ message, language }) });
  return { send, say };
}

afterEach(() => { vi.unstubAllGlobals(); });

describe('built-in clerk', () => {
  it('reads the cart through the same tools /mcp serves, answers, and keeps the conversation', async () => {
    const model = fakeModel([{ calls: [{ name: 'cart_list', args: {} }] }, { content: 'You have 5 things on the shelf.' }]);
    const { say, send } = world();
    const reply = await say('What is in my cart?');
    expect(reply.status).toBe(200);
    expect(reply.body.turns.map((turn: any) => [turn.role, turn.text])).toEqual([['owner', 'What is in my cart?'], ['clerk', 'You have 5 things on the shelf.']]);
    expect(reply.body.turns[1].calls).toEqual([{ name: 'cart_list', ok: true }]);
    const [first, second] = model.requests;
    expect(first.key).toBe(`Bearer ${HOUSE}`);
    expect(first.body.model).toBe('muse-spark-1.3');
    expect(first.body.tools.map((tool: any) => tool.function.name)).toContain('promo_generate');
    expect(first.body.messages[0].content).toContain('Reply in natural English');
    const toolMessage = second.body.messages.find((message: any) => message.role === 'tool');
    expect(JSON.parse(toolMessage.content).items).toHaveLength(5);
    expect(reply.body.spentUsd).toBeCloseTo(2 * (1000 / 1e6 * 1.25 + 100 / 1e6 * 4.25));
    fakeModel([{ content: 'Sure.' }]);
    expect((await send('/api/muse')).body.activity).toMatchObject({ client: { name: 'Showroom clerk' }, lastTool: { name: 'cart_list' } });
  });

  it('acts on the cart: a removal the clerk makes shows on the shelf', async () => {
    const { say, send } = world();
    const cart = (await send('/api/cart')).body;
    fakeModel([{ calls: [{ name: 'cart_remove', args: { itemId: cart.items[0].id } }] }, { content: 'Taken out.' }]);
    expect((await say('Take the first one out')).status).toBe(200);
    expect((await send('/api/cart')).body.items).toHaveLength(cart.items.length - 1);
  });

  it('stops calling tools at the per-turn cap and still ends in words', async () => {
    const loop = Array.from({ length: 20 }, () => ({ calls: [{ name: 'cart_list', args: {} }, { name: 'cart_list', args: {} }, { name: 'cart_list', args: {} }] }));
    const model = fakeModel([...loop]);
    const reply = await world().say('loop');
    expect(reply.status).toBe(200);
    expect(reply.body.turns[1].calls.length).toBeLessThanOrEqual(CLERK_LIMITS.toolCallsPerTurn);
    expect(model.requests.length).toBeLessThanOrEqual(CLERK_LIMITS.modelStepsPerTurn);
    expect(model.requests.at(-1)!.body.tool_choice).toBe('none');
  });

  it('stops on the house key at the daily limit and asks for the owner\'s own key, which it then uses and only shows the end of', async () => {
    const { say, send } = world({ CLERK_DAILY_USD: '0.001' });
    fakeModel([{ content: 'Hi!', usage: { prompt_tokens: 1000, completion_tokens: 0 } }]);
    expect((await say('hi')).status).toBe(200);
    const limited = await say('again');
    expect(limited.status).toBe(429);
    expect(limited.body).toMatchObject({ error: 'daily_limit', ready: 'daily_limit' });
    const saved = await send('/api/clerk/key', { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ apiKey: OWN }) });
    expect(saved.body).toMatchObject({ ready: 'own', ownKey: { keyEnd: '…9876' } });
    expect(JSON.stringify(saved.body)).not.toContain(OWN);
    const model = fakeModel([{ content: 'Back again.' }]);
    expect((await say('again')).status).toBe(200);
    expect(model.requests[0].key).toBe(`Bearer ${OWN}`);
  });

  it('keeps keys out of errors and stays shut to visitors', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(`bad key ${HOUSE}`, { status: 401 })));
    const failed = await world().say('hi');
    expect(failed.status).toBe(502);
    expect(failed.body.message).not.toContain(HOUSE);

    const hosted = world({ OPEN_OWNER_ACCESS: undefined, CART_MCP_TOKEN: 'owner-token-0123' });
    expect((await hosted.say('hi')).status).toBe(401);
    expect((await hosted.send('/api/clerk')).status).toBe(401);
  });

  it('says there is no key when neither the house nor the owner has one', async () => {
    expect(chooseKey(emptyClerkState(), {}, new Date())).toEqual({ kind: 'none', reason: 'no_key' });
    const reply = await world({ META_API_KEY: undefined, META_API_BASE_URL: undefined }).say('hi');
    expect(reply.status).toBe(409);
    expect(reply.body.error).toBe('no_key');
  });
});
