import { describe, expect, it } from 'vitest';
import { characters } from '../shared/domain';
import { castViewSchema } from '../shared/cast';
import type { Env } from '../worker/env';
import { Showroom } from '../worker/showroom';
import { memoryBucket, memoryState } from './memory-state';

const token = 'test-token-0123456789';
const owner = { authorization: `Bearer ${token}` };

/** One Showroom over `state`; a second call with the same state is "a new object over the same storage". */
function room(state = memoryState(), vars: Partial<Env> = {}) {
  const MEDIA = memoryBucket();
  const env = { CART_MCP_TOKEN: token, MEDIA, ...vars } as unknown as Env;
  const showroom = new Showroom(state, env);
  const send = (path: string, init: RequestInit & { as?: Record<string, string> } = {}) => showroom.fetch(new Request(`https://showroom.test${path}`, { ...init, headers: { ...init.as, ...init.headers } }));
  const view = async (as: Record<string, string> = owner) => castViewSchema.parse(await (await send('/api/cast', { as })).json());
  const choose = (body: unknown) => send('/api/cast', { method: 'PUT', as: { ...owner, 'content-type': 'application/json' }, body: JSON.stringify(body) });
  return { state, env, MEDIA, send, view, choose };
}

describe('the clerk the owner picks', () => {
  it('starts as the default clerk with a placeholder in the owner spot', async () => {
    const first = await room().view();
    expect(first).toMatchObject({ character: 'clerk', owner: { kind: 'placeholder' }, nickname: '屋主' });
  });

  it('is still the pick when a new object reads the same storage', async () => {
    const state = memoryState();
    for (const character of characters) {
      expect((await room(state).choose({ character })).status).toBe(200);
      expect((await room(state).view()).character).toBe(character);
    }
  });

  it('refuses a character that is not in the registry, and keeps the old pick', async () => {
    const state = memoryState();
    await room(state).choose({ character: 'apron' });
    for (const body of [{ character: 'claude' }, { character: '' }, {}, { character: 'cap', extra: 1 }]) expect((await room(state).choose(body)).status).toBe(400);
    expect((await room(state).send('/api/cast', { method: 'PUT', as: owner, body: '{not json' })).status).toBe(400);
    expect((await room(state).view()).character).toBe('apron');
  });

  it('answers only the owner', async () => {
    const { send, choose } = room();
    expect((await send('/api/cast')).status).toBe(401);
    expect((await send('/api/cast', { as: { authorization: 'Bearer wrong-token-000000000' } })).status).toBe(401);
    expect((await send('/api/cast', { method: 'PUT', body: JSON.stringify({ character: 'cap' }) })).status).toBe(401);
    expect((await choose({ character: 'cap' })).status).toBe(200);
    expect((await room(undefined, {}).send('/api/cast')).status).toBe(401);
  });

  it('shows the nickname from the share settings on the nameplate', async () => {
    const state = memoryState();
    const showroom = room(state);
    await showroom.send('/api/share', { method: 'PUT', as: { ...owner, 'content-type': 'application/json' }, body: JSON.stringify({ enabled: false, prices: 'hidden', nickname: '小島' }) });
    expect((await room(state).view()).nickname).toBe('小島');
  });
});
