import { describe, expect, it } from 'vitest';
import { emptyCart, replaceCart } from '../shared/cart';
import { cleanProductUrl, productImageIn, withProductImages } from '../worker/productPage';

const page = (head: string) => `<!doctype html><html><head>${head}</head><body></body></html>`;

describe('productImageIn', () => {
  it('reads og:image, resolving a relative path against the page', () => {
    expect(productImageIn(page('<meta property="og:image" content="/img/mug.jpg?w=800&amp;h=800">'), 'https://shop.example/p/1')).toBe('https://shop.example/img/mug.jpg?w=800&h=800');
  });

  it('falls back to a schema.org Product image when there is no card', () => {
    const ld = '<script type="application/ld+json">{"@graph":[{"@type":"WebPage"},{"@type":"Product","image":[{"url":"https://cdn.example/tote.webp"}]}]}</script>';
    expect(productImageIn(page(ld), 'https://shop.example/p/2')).toBe('https://cdn.example/tote.webp');
  });

  it('gives null for a page that names no picture, or only a non-web one', () => {
    expect(productImageIn(page('<title>無圖</title>'), 'https://shop.example/')).toBeNull();
    expect(productImageIn(page('<meta name="twitter:image" content="data:image/png;base64,AAAA">'), 'https://shop.example/')).toBeNull();
  });
});

describe('cleanProductUrl', () => {
  it('drops tracking parameters and the fragment, keeping the ones that pick the product', () => {
    expect(cleanProductUrl('https://shop.example/p/1?variant=7&utm_source=muse&fbclid=abc#reviews')).toBe('https://shop.example/p/1?variant=7');
  });
});

describe('withProductImages', () => {
  const html = (image: string) => new Response(page(`<meta property="og:image" content="${image}">`), { headers: { 'content-type': 'text/html; charset=utf-8' } });

  it('fills a missing image from the product page and fetches each link once', async () => {
    const asked: string[] = [];
    const http = (async (url: string) => { asked.push(url); return html('https://cdn.example/a.jpg'); }) as unknown as typeof fetch;
    const out = await withProductImages([{ title: '馬克杯', url: 'https://shop.example/a?utm_medium=x', qty: 1 }, { title: '馬克杯 第二色', url: 'https://shop.example/a', qty: 1 }], emptyCart(), http);
    expect(out.map(item => [item.url, item.imageUrl])).toEqual([['https://shop.example/a', 'https://cdn.example/a.jpg'], ['https://shop.example/a', 'https://cdn.example/a.jpg']]);
    expect(asked).toEqual(['https://shop.example/a']);
  });

  it('keeps a given image, reuses what the cart already knows, and leaves an item alone when the page fails', async () => {
    const previous = replaceCart(emptyCart(), [{ title: '托特包', url: 'https://shop.example/tote', imageUrl: 'https://cdn.example/tote.jpg', qty: 1 }], '2026-10-31T00:00:00.000Z');
    const http = (async () => new Response('nope', { status: 503 })) as unknown as typeof fetch;
    const out = await withProductImages([
      { title: '托特包', url: 'https://shop.example/tote', qty: 1 },
      { title: '濾杯', url: 'https://shop.example/dripper', imageUrl: 'https://cdn.example/given.jpg', qty: 1 },
      { title: '耳機', url: 'https://shop.example/down', qty: 1 },
    ], previous, http);
    expect(out.map(item => item.imageUrl)).toEqual(['https://cdn.example/tote.jpg', 'https://cdn.example/given.jpg', undefined]);
  });
});
