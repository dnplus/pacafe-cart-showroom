import { webUrl, type Cart, type CartItemInput } from '../shared/cart';

/** Query parameters that only track where a visit came from; a product link is the same page without them. */
const TRACKING = /^(utm_\w+|fbclid|gclid|gbraid|wbraid|yclid|msclkid|igshid|mc_cid|mc_eid|_ga|ref_src|spm|scm)$/i;

export function cleanProductUrl(url: string): string {
  const parsed = new URL(url);
  for (const key of [...parsed.searchParams.keys()]) if (TRACKING.test(key)) parsed.searchParams.delete(key);
  parsed.hash = '';
  return parsed.toString();
}

const META_IMAGE = /<meta\s[^>]*(?:property|name)\s*=\s*["'](?:og:image(?::secure_url)?|twitter:image(?::src)?)["'][^>]*>/gi;
const CONTENT = /\scontent\s*=\s*["']([^"']+)["']/i;
const LD_JSON = /<script[^>]*type\s*=\s*["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;

const decode = (text: string) => text.replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;/g, "'");

function ldImage(node: unknown): string | null {
  if (!node || typeof node !== 'object') return null;
  if (Array.isArray(node)) { for (const child of node) { const found = ldImage(child); if (found) return found; } return null; }
  const record = node as Record<string, unknown>;
  const type = [record['@type']].flat();
  if (type.includes('Product') && record.image) {
    const image = [record.image].flat()[0];
    if (typeof image === 'string') return image;
    if (image && typeof image === 'object' && typeof (image as { url?: unknown }).url === 'string') return (image as { url: string }).url;
  }
  return ldImage(record['@graph']);
}

export function productImageIn(html: string, pageUrl: string): string | null {
  const candidates = [...html.matchAll(META_IMAGE)].map(tag => tag[0].match(CONTENT)?.[1]).filter((value): value is string => !!value);
  for (const [, body] of html.matchAll(LD_JSON)) {
    try { const found = ldImage(JSON.parse(body)); if (found) candidates.push(found); } catch {}
  }
  for (const candidate of candidates) {
    try {
      const absolute = new URL(decode(candidate.trim()), pageUrl).toString();
      if (webUrl.safeParse(absolute).success) return absolute;
    } catch {}
  }
  return null;
}

const PAGE_TIMEOUT_MS = 5000;
const PAGE_MAX_BYTES = 768 * 1024;

export async function fetchProductImage(url: string, http: typeof fetch = fetch): Promise<string | null> {
  try {
    const response = await http(url, { redirect: 'follow', signal: AbortSignal.timeout(PAGE_TIMEOUT_MS), headers: { accept: 'text/html', 'user-agent': 'Mozilla/5.0 (compatible; pacafe-cart-showroom/0.1; +product preview)' } });
    if (!response.ok || !response.body || !(response.headers.get('content-type') ?? '').includes('html')) return null;
    const reader = response.body.getReader(), chunks: Uint8Array[] = [];
    let size = 0;
    while (size < PAGE_MAX_BYTES) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value); size += value.byteLength;
    }
    await reader.cancel().catch(() => {});
    const bytes = new Uint8Array(size);
    chunks.reduce((offset, chunk) => { bytes.set(chunk, offset); return offset + chunk.byteLength; }, 0);
    const html = new TextDecoder().decode(bytes);
    return productImageIn(html, response.url || url);
  } catch {
    return null;
  }
}

export async function withProductImages(inputs: readonly CartItemInput[], previous: Cart, http: typeof fetch = fetch): Promise<CartItemInput[]> {
  const known = new Map(previous.items.filter(item => item.url && item.imageUrl).map(item => [item.url!, item.imageUrl!]));
  const pending = new Map<string, Promise<string | null>>();
  return Promise.all(inputs.map(async input => {
    if (!input.url) return input;
    const url = cleanProductUrl(input.url);
    if (input.imageUrl) return { ...input, url };
    if (known.has(url)) return { ...input, url, imageUrl: known.get(url) };
    if (!pending.has(url)) pending.set(url, fetchProductImage(url, http));
    const imageUrl = await pending.get(url)!;
    return imageUrl ? { ...input, url, imageUrl } : { ...input, url };
  }));
}
