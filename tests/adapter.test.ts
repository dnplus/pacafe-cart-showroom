import { describe, expect, it } from 'vitest';
import { mcpClient } from '../adapter/mcp-client';
import { runTask } from '../adapter/run';
import { outputTextOf, parseResponse, toFunctionTools } from '../adapter/translate';
import { cartSchema } from '../shared/cart';
import type { Env } from '../worker/env';
import worker from '../worker/index';
import { Showroom } from '../worker/showroom';
import { memoryState } from './memory-state';

const token = 'test-token-0123456789';
const apiKey = 'fake-model-key-0123456789';
const origin = 'https://showroom.test';
const toolNames = ['cart_add', 'cart_list', 'cart_remove', 'habits_report', 'promo_generate', 'promo_status'];

/** The real worker over one real Showroom held in memory, reached through a fetch the MCP client can use. */
function showroom() {
  const state = memoryState();
  const env = { CART_MCP_TOKEN: token, SHOWROOM: { idFromName: (name: string) => name, get: () => new Showroom(state, env) }, ASSETS: { fetch: async () => new Response('app') } } as unknown as Env;
  const send = (input: RequestInfo | URL, init?: RequestInit) => worker.fetch(new Request(input, init) as Parameters<typeof worker.fetch>[0], env);
  return { fetch: send as typeof fetch, cart: async () => cartSchema.parse(await (await send(`${origin}/api/cart`, { headers: { authorization: `Bearer ${token}` } })).json()) };
}

const functionCall = (id: string, name: string, args: unknown) => ({ type: 'function_call', call_id: id, name, arguments: typeof args === 'string' ? args : JSON.stringify(args) });
const reply = (id: string, ...output: object[]) => ({ id, output });
const finalMessage = (id: string, text: string) => reply(id, { type: 'message', role: 'assistant', content: [{ type: 'output_text', text }] });

/** A Model API that answers each request from the script in turn and keeps what it was sent. */
function scriptedModel(script: (object | ((request: any, nth: number) => object))[]) {
  const requests: any[] = [];
  const send = (async (input: RequestInfo | URL, init?: RequestInit) => {
    expect(String(input)).toBe('https://model.test/v1/responses');
    expect(new Headers(init?.headers).get('authorization')).toBe(`Bearer ${apiKey}`);
    const request = JSON.parse(String(init?.body));
    requests.push(request);
    const next = script[Math.min(requests.length, script.length) - 1];
    return Response.json(typeof next === 'function' ? next(request, requests.length) : next);
  }) as typeof fetch;
  return { fetch: send, requests };
}

const messageOf = async (attempt: Promise<unknown>) => attempt.then(() => expect.unreachable('should have failed'), (error: Error) => error.message);

async function run(options: { model: ReturnType<typeof scriptedModel>; room?: ReturnType<typeof showroom>; maxSteps?: number }) {
  const room = options.room ?? showroom();
  const mcp = mcpClient({ url: `${origin}/mcp`, token, fetch: room.fetch });
  await mcp.initialize();
  return runTask({ prompt: '記下兩件東西', instructions: 'be helpful', model: 'muse-spark-1.3', apiBaseUrl: 'https://model.test/v1', apiKey, mcp, fetch: options.model.fetch, maxSteps: options.maxSteps });
}

describe('adapter', () => {
  it('drives the model through the six tools and into the cart behind the showroom', async () => {
    const room = showroom();
    const model = scriptedModel([
      reply('resp-1', functionCall('call-1', 'cart_add', { title: '陶瓷馬克杯', store: '小島陶房', priceTwd: 420, qty: 2 }), functionCall('call-2', 'cart_add', { title: '亞麻餐墊', priceTwd: 290 })),
      reply('resp-2', functionCall('call-3', 'cart_list', {})),
      reply('resp-3', functionCall('call-4', 'promo_generate', { style: '溫暖' })),
      finalMessage('resp-4', '記好了兩件，介紹片已排程。'),
    ]);

    const result = await run({ model, room });

    expect(result.text).toBe('記好了兩件，介紹片已排程。');
    expect(result.steps).toBe(4);
    expect(result.calls).toEqual(['cart_add', 'cart_add', 'cart_list', 'promo_generate'].map(name => ({ name, isError: false })));
    const cart = await room.cart();
    expect(cart.items.map(item => [item.title, item.qty])).toEqual([['陶瓷馬克杯', 2], ['亞麻餐墊', 1]]);
    expect(cart.totalTwd).toBe(420 * 2 + 290);

    const [first, ...later] = model.requests;
    expect(first).toMatchObject({ model: 'muse-spark-1.3', instructions: 'be helpful', input: '記下兩件東西', tool_choice: 'auto' });
    expect(first.previous_response_id).toBeUndefined();
    expect(first.tools.map((tool: { name: string }) => tool.name).sort()).toEqual(toolNames);
    expect(first.tools.every((tool: any) => tool.type === 'function' && tool.description && tool.parameters.type === 'object' && !('inputSchema' in tool))).toBe(true);
    expect(first.tools.find((tool: { name: string }) => tool.name === 'cart_add').parameters.required).toEqual(['title']);

    expect(later.map(request => request.previous_response_id)).toEqual(['resp-1', 'resp-2', 'resp-3']);
    expect(later.map(request => request.input.map((item: { call_id: string }) => item.call_id))).toEqual([['call-1', 'call-2'], ['call-3'], ['call-4']]);
    expect(later.every(request => request.tool_choice === 'auto' && request.tools.length === toolNames.length && request.input.every((item: { type: string }) => item.type === 'function_call_output'))).toBe(true);
    const listing = JSON.parse(later[1].input[0].output);
    expect(listing.items).toHaveLength(2);
    expect(listing.share.url).toMatch(/^https:\/\/showroom\.test\/s\//);
    expect(JSON.parse(later[2].input[0].output)).toEqual({ jobId: expect.stringMatching(/^promo-/), status: 'queued' });
  });

  it('hands a failed tool back to the model instead of throwing', async () => {
    const model = scriptedModel([
      reply('resp-1', functionCall('call-1', 'cart_remove', { itemId: 'item-nope-0' }), functionCall('call-2', 'cart_add', { priceTwd: 10 })),
      finalMessage('resp-2', '那件不在購物車裡。'),
    ]);

    const result = await run({ model });

    expect(result.text).toBe('那件不在購物車裡。');
    expect(result.calls).toEqual([{ name: 'cart_remove', isError: true }, { name: 'cart_add', isError: true }]);
    const [removed, added] = model.requests[1].input;
    expect(removed).toEqual({ type: 'function_call_output', call_id: 'call-1', output: expect.stringContaining('購物車裡沒有 itemId「item-nope-0」') });
    expect(added.output).toContain('title');
  });

  it('tells the model when its arguments are not JSON, without calling the tool', async () => {
    const room = showroom();
    const model = scriptedModel([reply('resp-1', functionCall('call-1', 'cart_add', '{"title": ')), finalMessage('resp-2', 'ok')]);

    const result = await run({ model, room });

    expect(result.calls).toEqual([{ name: 'cart_add', isError: true }]);
    expect(model.requests[1].input[0].output).toContain('不是有效的 JSON');
    expect((await room.cart()).items).toEqual([]);
  });

  it('stops a model that never stops calling tools', async () => {
    const room = showroom();
    const model = scriptedModel([reply('resp-n', functionCall('call-n', 'cart_list', {}))]);

    await expect(run({ model, room, maxSteps: 3 })).rejects.toThrow('3 步');
    expect(model.requests).toHaveLength(3);
  });

  it('names the status and never the key when the Model API refuses', async () => {
    const refusing = { fetch: (async () => new Response(`bad key ${apiKey}`, { status: 401 })) as typeof fetch, requests: [] };
    const message = await messageOf(run({ model: refusing }));
    expect(message).toContain('HTTP 401');
    expect(message).not.toContain(apiKey);
  });
});

describe('mcpClient', () => {
  it('names the status and message of a refusal, never the token', async () => {
    const room = showroom();
    const wrongToken = 'test-token-0123456780';
    const refused = await messageOf(mcpClient({ url: `${origin}/mcp`, token: wrongToken, fetch: room.fetch }).initialize());
    expect(refused).toContain('HTTP 401');
    expect(refused).not.toContain(wrongToken);

    const mcp = mcpClient({ url: `${origin}/mcp`, token, fetch: room.fetch });
    await mcp.initialize();
    const unknown = await messageOf(mcp.callTool('checkout', {}));
    expect(unknown).toContain('-32602');
    expect(unknown).toContain('checkout');
  });
});

describe('translate', () => {
  it('refuses a tool whose name has more than one dot', () => {
    const tool = (name: string) => ({ name, inputSchema: { type: 'object' } });
    expect(toFunctionTools([tool('cart.add')])).toEqual([{ type: 'function', name: 'cart.add', parameters: { type: 'object' } }]);
    expect(() => toFunctionTools([tool('showroom.cart.add')])).toThrow('showroom.cart.add');
  });

  it('reads the answer from the message items, or from output_text when the API sends it', () => {
    const message = { type: 'message', content: [{ type: 'output_text', text: '你好' }, { type: 'refusal', refusal: 'x' }, { type: 'output_text', text: '，屋主' }] };
    expect(outputTextOf(parseResponse({ id: 'r', output: [{ type: 'reasoning' }, message] }))).toBe('你好，屋主');
    expect(outputTextOf(parseResponse({ id: 'r', output: [message], output_text: '全文' }))).toBe('全文');
  });
});
