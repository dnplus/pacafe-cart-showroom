import { describe, expect, it } from 'vitest';
import type { Env } from '../worker/env';
import worker from '../worker/index';
import { memoryBucket } from './memory-state';

const token = 'test-token-0123456789';
const setup = (vars: Partial<Env> = {}) => {
  const MEDIA = memoryBucket();
  const env = { CART_MCP_TOKEN: token, MEDIA, ASSETS: { fetch: async () => new Response('app') }, ...vars } as unknown as Env;
  const get = (path: string, headers: Record<string, string> = {}, method = 'GET') => worker.fetch(new Request(`https://showroom.test${path}`, { method, headers }) as Parameters<typeof worker.fetch>[0], env);
  return { MEDIA, get };
};

describe('/media', () => {
  it('serves a promo file to anyone, with its type and a byte range', async () => {
    const { MEDIA, get } = setup();
    await MEDIA.put('promo/promo-1/video.mp4', new Uint8Array([1, 2, 3, 4, 5]), { httpMetadata: { contentType: 'video/mp4' } });
    const whole = await get('/media/promo/promo-1/video.mp4');
    expect(whole.status).toBe(200);
    expect(whole.headers.get('content-type')).toBe('video/mp4');
    expect([...new Uint8Array(await whole.arrayBuffer())]).toEqual([1, 2, 3, 4, 5]);
    const part = await get('/media/promo/promo-1/video.mp4', { range: 'bytes=1-2' });
    expect(part.status).toBe(206);
    expect(part.headers.get('content-range')).toBe('bytes 1-2/5');
    expect([...new Uint8Array(await part.arrayBuffer())]).toEqual([2, 3]);
  });

  it('serves the owner area only with the owner key', async () => {
    const { MEDIA, get } = setup();
    await MEDIA.put('owner/sprite.png', new Uint8Array([9]), { httpMetadata: { contentType: 'image/png' } });
    expect((await get('/media/owner/sprite.png')).status).toBe(401);
    expect((await get('/media/owner/sprite.png', { authorization: 'Bearer wrong-token-000000000' })).status).toBe(401);
    const owned = await get('/media/owner/sprite.png', { authorization: `Bearer ${token}` });
    expect(owned.status).toBe(200);
    expect(owned.headers.get('cache-control')).toContain('no-store');
  });

  it('answers 404 for a missing object or a key outside the known areas, and 405 for writes', async () => {
    const { MEDIA, get } = setup();
    await MEDIA.put('secret/thing', 'x');
    expect((await get('/media/promo/none.mp4')).status).toBe(404);
    expect((await get('/media/secret/thing')).status).toBe(404);
    expect((await get('/media/promo/.hidden')).status).toBe(404);
    expect((await get('/media/promo/a.mp4', {}, 'DELETE')).status).toBe(405);
  });
});
