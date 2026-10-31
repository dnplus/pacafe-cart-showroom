import type { Cart } from '../shared/cart';
import type { ShareView } from '../shared/share';

/** The room draws a product's picture as a WebGL texture, which needs a same-origin (or CORS) image, so the worker hands the picture over itself. */
export const IMAGE_MAX_BYTES = 4 * 1024 * 1024;
const IMAGE_TIMEOUT_MS = 6000;
const MAX_REDIRECTS = 3;
const MAX_RETRY_WAIT_S = 2;
const HIDDEN_SUFFIXES = ['.localhost', '.local', '.internal', '.lan', '.home.arpa', '.intranet'];

const normalize = (url: string) => { try { return new URL(url).href; } catch { return null; } };
const setOf = (urls: readonly (string | null)[]) => new Set(urls.map(url => url && normalize(url)).filter((url): url is string => !!url));

/** Every picture the owner's cart names, which is all the owner's room may ask for. */
export const cartImageUrls = (cart: Cart) => setOf(cart.items.flatMap(item => [item.cutoutUrl, item.imageUrl]));
/** Only the pictures a visitor's view carries; the view is what the owner chose to share, so nothing else is reachable through a slug. */
export const shareImageUrls = (view: ShareView) => setOf(view.items.map(item => item.imageUrl));

/** A public web address: http(s) on the usual ports, a named host with a dot, never an IP literal or a name that points inside a network. */
export function isPublicImageUrl(url: URL) {
  if ((url.protocol !== 'https:' && url.protocol !== 'http:') || url.username || url.password) return false;
  if (url.port && url.port !== '80' && url.port !== '443') return false;
  const host = url.hostname.toLowerCase().replace(/\.$/, '');
  if (!host.includes('.') || host.includes(':') || host.startsWith('[') || /^[\d.]+$/.test(host)) return false;
  return !HIDDEN_SUFFIXES.some(suffix => host.endsWith(suffix));
}

const refuse = (error: string, status: number) => Response.json({ error }, { status, headers: { 'cache-control': 'no-store' } });
const deliveryHeaders = (type: string, size: number) => ({
  'content-type': type, 'content-length': String(size), 'cache-control': 'private, max-age=86400',
  'x-content-type-options': 'nosniff', 'content-security-policy': "default-src 'none'; sandbox", 'referrer-policy': 'no-referrer',
});

/** The image at `target` if it is one the caller may see; one 404 for anything else, so the route cannot be used to probe or relay. */
export async function serveImage(target: string | null, allowed: ReadonlySet<string>, http: typeof fetch = fetch): Promise<Response> {
  const listed = target === null ? null : normalize(target);
  if (!listed || !allowed.has(listed)) return refuse('not_found', 404);
  let current = new URL(listed), waited = false;
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    if (!isPublicImageUrl(current)) return refuse('unsafe_address', 403);
    let upstream: Response;
    try { upstream = await http(current, { redirect: 'manual', signal: AbortSignal.timeout(IMAGE_TIMEOUT_MS), headers: { accept: 'image/*', 'user-agent': 'Mozilla/5.0 (compatible; pacafe-cart-showroom/0.1; +product picture)' } }); }
    catch { return refuse('upstream_failed', 502); }
    const next = upstream.status >= 300 && upstream.status < 400 ? upstream.headers.get('location') : null;
    if (next) {
      await upstream.body?.cancel().catch(() => {});
      try { current = new URL(next, current); } catch { return refuse('upstream_failed', 502); }
      continue;
    }
    const wait = Number(upstream.headers.get('retry-after'));
    // A store's CDN that says "again in a second" (a burst of pictures from one cart does that) is asked once more.
    if ((upstream.status === 429 || upstream.status === 503) && !waited && wait >= 0 && wait <= MAX_RETRY_WAIT_S) {
      waited = true; hop--;
      await upstream.body?.cancel().catch(() => {});
      await new Promise(resolve => setTimeout(resolve, wait * 1000));
      continue;
    }
    if (!upstream.ok || !upstream.body) { await upstream.body?.cancel().catch(() => {}); return refuse('upstream_failed', 502); }
    const type = (upstream.headers.get('content-type') ?? '').split(';')[0].trim().toLowerCase();
    // An SVG can carry script, and this answer is same-origin with the app.
    if (!type.startsWith('image/') || type === 'image/svg+xml') { await upstream.body.cancel().catch(() => {}); return refuse('not_an_image', 415); }
    if (Number(upstream.headers.get('content-length')) > IMAGE_MAX_BYTES) { await upstream.body.cancel().catch(() => {}); return refuse('too_large', 413); }
    const reader = upstream.body.getReader(), chunks: Uint8Array[] = [];
    let size = 0;
    for (;;) {
      const { done, value } = await reader.read().catch(() => ({ done: true as const, value: undefined }));
      if (done || !value) break;
      size += value.byteLength;
      if (size > IMAGE_MAX_BYTES) { await reader.cancel().catch(() => {}); return refuse('too_large', 413); }
      chunks.push(value);
    }
    const bytes = new Uint8Array(size);
    chunks.reduce((offset, chunk) => { bytes.set(chunk, offset); return offset + chunk.byteLength; }, 0);
    return new Response(bytes, { headers: deliveryHeaders(type, size) });
  }
  return refuse('upstream_failed', 502);
}
