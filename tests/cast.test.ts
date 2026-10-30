import { afterEach, describe, expect, it, vi } from 'vitest';
import { characters } from '../shared/domain';
import { castViewSchema } from '../shared/cast';
import type { Env } from '../worker/env';
import worker from '../worker/index';
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

const photoBytes = Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, ...Array.from({ length: 40 }, (_, i) => i)]);
const spriteBytes = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4]);
const secrets = { META_API_KEY: 'sk-test-secret-key-123', META_API_BASE_URL: 'https://meta.test/v1' };
const b64 = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes));
const modelAnswer = (bytes = spriteBytes) => Response.json({ data: [{ b64_json: b64(bytes) }] });

/** Stands in for the Meta Model API: no test here may reach the real one. */
const fakeModel = (answer: () => Response | Promise<Response> = () => modelAnswer()) => { const mock = vi.fn(async (_url: unknown, _init?: RequestInit) => answer()); vi.stubGlobal('fetch', mock); return mock; };
const sentBody = (mock: ReturnType<typeof fakeModel>) => JSON.parse(mock.mock.calls[0][1]!.body as string) as Record<string, unknown>;
const form = (fields: { photo?: Uint8Array | string; type?: string; consent?: string }) => {
  const body = new FormData();
  if (fields.photo !== undefined) body.set('photo', new File([fields.photo as BlobPart], 'me.jpg', { type: fields.type ?? 'image/jpeg' }));
  if (fields.consent !== undefined) body.set('consent', fields.consent);
  return body;
};
const draw = (showroom: ReturnType<typeof room>, fields: Parameters<typeof form>[0] = { photo: photoBytes, consent: 'true' }, as: Record<string, string> = owner) => showroom.send('/api/cast/owner-sprite', { method: 'POST', as, body: form(fields) });

afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe('the owner sprite', () => {
  it('without a Meta key says what is missing and never calls the API', async () => {
    const mock = fakeModel();
    for (const vars of [{}, { META_API_KEY: secrets.META_API_KEY }, { META_API_BASE_URL: secrets.META_API_BASE_URL }]) {
      const showroom = room(undefined, vars);
      expect((await showroom.view()).spriteGeneration).toEqual({ available: false, reason: 'needs_meta_api_key' });
      const answer = await draw(showroom);
      expect(answer.status).toBe(503);
      expect(await answer.json()).toEqual({ error: 'needs_meta_api_key' });
    }
    expect(mock).not.toHaveBeenCalled();
  });

  it('reports the button usable when both secrets are set', async () => {
    expect((await room(undefined, secrets).view()).spriteGeneration).toEqual({ available: true });
  });

  it('asks Muse Image for a sprite with image search off and a prompt that names no brand', async () => {
    const mock = fakeModel(), showroom = room(undefined, secrets);
    expect((await draw(showroom)).status).toBe(200);
    expect(mock).toHaveBeenCalledTimes(1);
    const [url, init] = mock.mock.calls[0];
    expect(url).toBe('https://meta.test/v1/images/generations');
    expect((init!.headers as Record<string, string>).authorization).toBe(`Bearer ${secrets.META_API_KEY}`);
    const payload = sentBody(mock);
    expect(payload.model).toBe('muse-image-1.0');
    expect(payload.enable_image_search).toBe(false);
    expect(payload.prompt).toEqual(expect.any(String));
    expect(payload.prompt).not.toMatch(/muse|jolly|mascot|meta/i);
    expect(Object.values(payload).filter(value => typeof value === 'string' && value.startsWith(`data:image/jpeg;base64,${b64(photoBytes)}`))).toHaveLength(1);
  });

  it('keeps the sprite in the owner area with its AI provenance, and never the photo', async () => {
    fakeModel();
    const state = memoryState(), showroom = room(state, secrets);
    const done = castViewSchema.parse(await (await draw(showroom)).json());
    if (done.owner.kind !== 'generated') throw new Error('expected a generated sprite');
    expect(done.owner.key).toMatch(/^owner\/sprite-[0-9a-f-]{36}\.png$/);
    expect([...showroom.MEDIA.data.keys()]).toEqual([done.owner.key]);
    const stored = await showroom.MEDIA.head(done.owner.key);
    expect([...new Uint8Array(await stored!.arrayBuffer())]).toEqual([...spriteBytes]);
    expect(stored!.httpMetadata!.contentType).toBe('image/png');
    expect(stored!.customMetadata).toEqual({ aiGenerated: 'true', model: 'muse-image-1.0', generatedAt: done.owner.generatedAt, enableImageSearch: 'false' });
    expect(done.owner.model).toBe('muse-image-1.0');
    const again = room(state, secrets);
    expect((await again.view()).owner).toEqual(done.owner);
  });

  it('needs the owner and the consent box, and a JPEG or PNG within 2 MB', async () => {
    const mock = fakeModel(), showroom = room(undefined, secrets);
    expect((await draw(showroom, undefined, {})).status).toBe(401);
    expect((await draw(showroom, { photo: photoBytes })).status).toBe(400);
    expect((await draw(showroom, { photo: photoBytes, consent: 'false' })).status).toBe(400);
    expect((await draw(showroom, { consent: 'true' })).status).toBe(400);
    expect((await draw(showroom, { photo: new TextEncoder().encode('GIF89a not a photo'), type: 'image/jpeg', consent: 'true' })).status).toBe(400);
    expect((await draw(showroom, { photo: new Uint8Array(2 * 1024 * 1024 + 1).fill(0xff), consent: 'true' })).status).toBe(413);
    const huge = await showroom.send('/api/cast/owner-sprite', { method: 'POST', as: { ...owner, 'content-length': String(5 * 1024 * 1024) }, body: form({ photo: photoBytes, consent: 'true' }) });
    expect(huge.status).toBe(413);
    expect(mock).not.toHaveBeenCalled();
    expect(showroom.MEDIA.data.size).toBe(0);
    expect((await showroom.view()).owner).toEqual({ kind: 'placeholder' });
  });

  it('answers 502 without the key or anything the API said when the API fails or sends no picture', async () => {
    const failures: (() => Response | Promise<Response>)[] = [
      () => new Response(`denied for ${secrets.META_API_KEY}`, { status: 401 }),
      () => new Response('overloaded', { status: 503 }),
      () => Response.json({ data: [{ b64_json: b64(new TextEncoder().encode('<html>not a picture</html>')) }] }),
      () => new Response('<html>hello</html>', { headers: { 'content-type': 'text/html' } }),
      () => Response.json({ data: [] }),
      () => { throw new TypeError(`connect failed with ${secrets.META_API_KEY}`); },
    ];
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    for (const failure of failures) {
      fakeModel(failure);
      const showroom = room(undefined, secrets), answer = await draw(showroom), text = await answer.text();
      expect(answer.status).toBe(502);
      expect(text).not.toContain(secrets.META_API_KEY);
      expect(text).not.toContain('overloaded');
      expect(showroom.MEDIA.data.size).toBe(0);
      expect((await showroom.view()).owner).toEqual({ kind: 'placeholder' });
    }
  });

  it('replaces the old sprite on a new one and deletes it when the owner goes back to the placeholder', async () => {
    fakeModel();
    const showroom = room(undefined, secrets);
    await draw(showroom); await draw(showroom);
    expect(showroom.MEDIA.data.size).toBe(1);
    const back = castViewSchema.parse(await (await showroom.send('/api/cast/owner-sprite', { method: 'DELETE', as: owner })).json());
    expect(back.owner).toEqual({ kind: 'placeholder' });
    expect(showroom.MEDIA.data.size).toBe(0);
    expect((await showroom.send('/api/cast/owner-sprite', { method: 'DELETE' })).status).toBe(401);
  });
});

describe('a visitor to the shared room', () => {
  it('learns nothing of the owner sprite, and cannot read it', async () => {
    fakeModel();
    const state = memoryState(), showroom = room(state, secrets);
    const done = castViewSchema.parse(await (await draw(showroom)).json());
    if (done.owner.kind !== 'generated') throw new Error('expected a generated sprite');
    const env = { ...showroom.env, SHOWROOM: { idFromName: (name: string) => name, get: () => new Showroom(state, showroom.env) }, ASSETS: { fetch: async () => new Response('app') } } as unknown as Env;
    const send = (path: string, headers: Record<string, string> = {}) => worker.fetch(new Request(`https://showroom.test${path}`, { headers }) as Parameters<typeof worker.fetch>[0], env);
    const shared = await (await send('/api/share', owner)).json() as { slug: string };
    await showroom.send('/api/share', { method: 'PUT', as: { ...owner, 'content-type': 'application/json' }, body: JSON.stringify({ enabled: true, prices: 'hidden', nickname: '小島' }) });
    const visit = await send(`/s/${shared.slug}`, { accept: 'application/json' });
    expect(visit.status).toBe(200);
    const text = await visit.text();
    expect(text).not.toMatch(/owner\/|sprite|generated|character|cast/);
    expect((await send(`/media/${done.owner.key}`)).status).toBe(401);
    expect((await send('/api/cast')).status).toBe(401);
    const mine = await send(`/media/${done.owner.key}`, owner);
    expect(mine.status).toBe(200);
    expect([...new Uint8Array(await mine.arrayBuffer())]).toEqual([...spriteBytes]);
  });
});
