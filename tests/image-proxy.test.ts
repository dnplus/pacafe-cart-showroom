import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Env } from '../worker/env';
import { IMAGE_MAX_BYTES, isPublicImageUrl, serveImage } from '../worker/imageProxy';
import worker from '../worker/index';
import { Showroom } from '../worker/showroom';
import { memoryState } from './memory-state';

const png = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 1, 2, 3]);
const mug = 'https://img.example/mug.png';
const listed = new Set([mug]);
const answer = (body: BodyInit | null, type: string, init: ResponseInit = {}) => new Response(body, { ...init, headers: { 'content-type': type, ...init.headers } });
const upstream = (make: () => Response) => vi.fn(async () => make());

describe('the image route only serves what the cart lists', () => {
  it('answers 404 for any address the allow-list does not hold, without fetching it', async () => {
    const http = upstream(() => answer(png, 'image/png'));
    for (const target of [null, '', 'not a url', 'https://img.example/other.png', 'https://img.example/mug.png?x=1', 'http://img.example/mug.png', 'file:///etc/passwd']) {
      const response = await serveImage(target, listed, http as unknown as typeof fetch);
      expect(response.status, String(target)).toBe(404);
    }
    expect(http).not.toHaveBeenCalled();
  });

  it('serves a listed picture with the headers a same-origin image needs and nothing a page could run', async () => {
    const http = upstream(() => answer(png, 'image/png; charset=binary'));
    const response = await serveImage(mug, listed, http as unknown as typeof fetch);
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe('image/png');
    expect(response.headers.get('cache-control')).toMatch(/max-age=\d+/);
    expect(response.headers.get('x-content-type-options')).toBe('nosniff');
    expect(response.headers.get('content-security-policy')).toContain('sandbox');
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(png);
  });

  it('refuses a listed address that is not an image, and an SVG, which can carry script', async () => {
    for (const type of ['text/html', 'application/json', 'image/svg+xml', '']) {
      const response = await serveImage(mug, listed, upstream(() => answer('<script>1</script>', type)) as unknown as typeof fetch);
      expect(response.status, type).toBe(415);
    }
  });

  it('refuses a picture past the size cap, whether the server says so up front or just keeps sending', async () => {
    const declared = await serveImage(mug, listed, upstream(() => answer(png, 'image/png', { headers: { 'content-length': String(IMAGE_MAX_BYTES + 1) } })) as unknown as typeof fetch);
    expect(declared.status).toBe(413);
    const chunk = new Uint8Array(1024 * 1024);
    let sent = 0;
    const endless = new ReadableStream<Uint8Array>({ pull(controller) { sent++; controller.enqueue(chunk); } });
    const streamed = await serveImage(mug, listed, upstream(() => answer(endless, 'image/png')) as unknown as typeof fetch);
    expect(streamed.status).toBe(413);
    expect(sent).toBeLessThan(IMAGE_MAX_BYTES / chunk.length + 4);
  });

  it('never fetches an address inside a network, even one the cart lists', async () => {
    const inside = ['http://127.0.0.1/a.png', 'http://localhost/a.png', 'http://10.0.0.5/a.png', 'http://169.254.169.254/latest', 'http://[::1]/a.png', 'http://printer/a.png', 'http://nas.local/a.png', 'https://img.example:8443/a.png', 'https://user:pw@img.example/a.png', 'http://2130706433/a.png'];
    const http = upstream(() => answer(png, 'image/png'));
    for (const address of inside) {
      expect((await serveImage(address, new Set([new URL(address).href]), http as unknown as typeof fetch)).status, address).toBe(403);
    }
    expect(http).not.toHaveBeenCalled();
    expect(isPublicImageUrl(new URL('https://cdn.shop.example/p/1.jpg'))).toBe(true);
  });

  it('follows a redirect to another public address but not into a network', async () => {
    const hops = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === mug) return new Response(null, { status: 302, headers: { location: 'https://cdn.example/mug.png' } });
      if (url === 'https://cdn.example/mug.png') return answer(png, 'image/png');
      return answer(png, 'image/png');
    });
    expect((await serveImage(mug, listed, hops as unknown as typeof fetch)).status).toBe(200);
    const inward = vi.fn(async () => new Response(null, { status: 302, headers: { location: 'http://169.254.169.254/latest/meta-data' } }));
    expect((await serveImage(mug, listed, inward as unknown as typeof fetch)).status).toBe(403);
    expect(inward).toHaveBeenCalledTimes(1);
    const loop = vi.fn(async () => new Response(null, { status: 302, headers: { location: mug } }));
    expect((await serveImage(mug, listed, loop as unknown as typeof fetch)).status).toBe(502);
    expect(loop.mock.calls.length).toBeLessThanOrEqual(4);
  });

  it('asks once more when the store says to wait a moment, and gives up if it says that twice', async () => {
    let calls = 0;
    const busyOnce = vi.fn(async () => ++calls === 1 ? new Response('slow down', { status: 429, headers: { 'retry-after': '0' } }) : answer(png, 'image/png'));
    expect((await serveImage(mug, listed, busyOnce as unknown as typeof fetch)).status).toBe(200);
    const busy = vi.fn(async () => new Response('slow down', { status: 429, headers: { 'retry-after': '0' } }));
    expect((await serveImage(mug, listed, busy as unknown as typeof fetch)).status).toBe(502);
    expect(busy).toHaveBeenCalledTimes(2);
    const long = vi.fn(async () => new Response('later', { status: 429, headers: { 'retry-after': '600' } }));
    expect((await serveImage(mug, listed, long as unknown as typeof fetch)).status).toBe(502);
    expect(long).toHaveBeenCalledTimes(1);
  });

  it('answers 502 when the picture cannot be had', async () => {
    expect((await serveImage(mug, listed, upstream(() => answer('gone', 'text/plain', { status: 404 })) as unknown as typeof fetch)).status).toBe(502);
    expect((await serveImage(mug, listed, vi.fn(async () => { throw new Error('down'); }) as unknown as typeof fetch)).status).toBe(502);
  });
});

const token = 'test-token-0123456789', origin = 'https://showroom.test', owner = { authorization: `Bearer ${token}` };
const plate = 'https://img.example/plate.png';

function world() {
  const state = memoryState();
  const env = { CART_MCP_TOKEN: token, SHOWROOM: { idFromName: (name: string) => name, get: () => new Showroom(state, env) }, ASSETS: { fetch: async () => new Response('app') } } as unknown as Env;
  const send = (path: string, init?: RequestInit) => worker.fetch(new Request(`${origin}${path}`, init) as Parameters<typeof worker.fetch>[0], env);
  const write = (items: unknown[]) => send('/api/cart', { method: 'POST', headers: { ...owner, 'content-type': 'application/json' }, body: JSON.stringify({ items }) });
  const share = (body: unknown) => send('/api/share', { method: 'PUT', headers: { ...owner, 'content-type': 'application/json' }, body: JSON.stringify(body) });
  const slug = async () => ((await (await send('/api/share', { headers: owner })).json()) as { slug: string }).slug;
  const image = (url: string, query = '', headers: Record<string, string> = {}) => send(`/api/image?${query}u=${encodeURIComponent(url)}`, { headers });
  return { write, share, slug, image };
}

describe('/api/image', () => {
  const fetched = vi.fn(async () => answer(png, 'image/png'));
  afterEach(() => { vi.unstubAllGlobals(); fetched.mockClear(); });
  const stubbed = () => vi.stubGlobal('fetch', fetched);

  it('gives the owner the pictures in the cart, with the token, and nothing else', async () => {
    stubbed();
    const { write, image } = world();
    await write([{ title: 'mug', imageUrl: mug, qty: 1 }]);
    expect((await image(mug)).status).toBe(401);
    expect((await image(mug, '', owner)).status).toBe(200);
    expect((await image(plate, '', owner)).status).toBe(404);
    expect(fetched).toHaveBeenCalledTimes(1);
  });

  it('stops serving a picture once its item has left the cart', async () => {
    stubbed();
    const { write, image } = world();
    await write([{ title: 'mug', imageUrl: mug, qty: 1 }]);
    expect((await image(mug, '', owner)).status).toBe(200);
    await write([{ title: 'plate', imageUrl: plate, qty: 1 }]);
    expect((await image(mug, '', owner)).status).toBe(404);
    expect((await image(plate, '', owner)).status).toBe(200);
  });

  it('serves a visitor only while sharing is on, only for the share slug, and only the pictures the shared view holds', async () => {
    stubbed();
    const { write, share, slug, image } = world();
    await write([{ title: 'mug', imageUrl: mug, qty: 1 }]);
    const id = await slug();
    expect((await image(mug, `s=${id}&`)).status).toBe(404);
    await share({ enabled: true, prices: 'hidden', nickname: 'x' });
    expect((await image(mug, `s=${id}&`)).status).toBe(200);
    expect((await image(mug, `s=${'B'.repeat(22)}&`)).status).toBe(404);
    expect((await image(mug, 's=&')).status).toBe(404);
    expect((await image(plate, `s=${id}&`)).status).toBe(404);
    await share({ enabled: false, prices: 'hidden', nickname: 'x' });
    expect((await image(mug, `s=${id}&`)).status).toBe(404);
    expect(fetched).toHaveBeenCalledTimes(1);
  });

  it('only answers GET', async () => {
    const response = await worker.fetch(new Request(`${origin}/api/image?u=${encodeURIComponent(mug)}`, { method: 'POST', headers: owner }) as Parameters<typeof worker.fetch>[0], { CART_MCP_TOKEN: token, SHOWROOM: { idFromName: (name: string) => name, get: () => new Showroom(memoryState(), { CART_MCP_TOKEN: token } as Env) }, ASSETS: {} } as unknown as Env);
    expect(response.status).toBe(405);
  });
});
