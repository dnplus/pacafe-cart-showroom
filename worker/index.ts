import { shareViewSchema, type ShareView } from '../shared/share';
import { castPath } from './cast';
import type { Env } from './env';
import { serveMedia } from './media';

// The Workers runtime binds the Durable Object class by name (wrangler.jsonc `class_name`), so the entry module exports it.
export { Showroom } from './showroom';

const showroom = (env: Env) => env.SHOWROOM.get(env.SHOWROOM.idFromName('default'));

/** On every /s/ answer: never cached or indexed, and product links opened from the page do not carry the slug in Referer. */
const shareHeaders = { 'cache-control': 'no-store', vary: 'accept', 'referrer-policy': 'no-referrer', 'x-robots-tag': 'noindex' };
const html = (body: string, status = 200) => new Response(body, { status, headers: { 'content-type': 'text/html; charset=utf-8' } });
const escapeHtml = (text: string) => text.replace(/[&<>"']/g, char => `&#${char.charCodeAt(0)};`);
const missingPage = '<!doctype html><html lang="zh-Hant-TW"><head><meta charset="utf-8"><meta name="robots" content="noindex"><meta name="viewport" content="width=device-width,initial-scale=1"><title>找不到這個分享</title></head><body><p>這個分享連結不存在或已關閉。</p></body></html>';

/** The app's index.html named for this share, so a pasted link previews as the owner's cart; never a price, whatever the mode. */
function namedPage(page: string, view: ShareView) {
  const title = escapeHtml(`${view.nickname} 的小屋購物車`), description = escapeHtml(`${view.items.length} 件東西`);
  // Replacer functions, so a `$` in the nickname is never read as a replacement pattern.
  return page.replace(/<title>[^<]*<\/title>/, () => `<title>${title}</title>`)
    .replace('</head>', () => `<meta name="robots" content="noindex"/><meta property="og:title" content="${title}"/><meta property="og:description" content="${description}"/></head>`);
}

/** JSON for the app's own fetch; a browser opening the link gets the app, or one plain 404 page for every way the link can fail. */
async function sharePage(request: Request, env: Env) {
  const answer = await showroom(env).fetch(request);
  if (request.headers.get('accept')?.includes('application/json') || (answer.status !== 200 && answer.status !== 404)) return answer;
  if (answer.status === 404) return html(missingPage, 404);
  const view = shareViewSchema.parse(await answer.json());
  const app = await env.ASSETS.fetch(new Request(new URL('/', request.url)));
  return html(namedPage(await app.text(), view));
}

export default {
  async fetch(request, env) {
    const { pathname } = new URL(request.url);
    if (pathname.startsWith('/s/')) {
      const answer = await sharePage(request, env), headers = new Headers(answer.headers);
      for (const [name, value] of Object.entries(shareHeaders)) headers.set(name, value);
      return new Response(answer.body, { status: answer.status, headers });
    }
    if (pathname.startsWith('/media/')) return serveMedia(request, env);
    if (pathname === '/api/promo' || pathname.startsWith('/runner/')) return showroom(env).fetch(request);
    if (pathname === '/api/cart' || pathname === '/api/share' || pathname === '/api/unbox' || castPath.test(pathname) || pathname === '/mcp') return showroom(env).fetch(request);
    if (pathname.startsWith('/api/')) return Response.json({ error: 'not_found' }, { status: 404 });
    return env.ASSETS.fetch(request);
  },
} satisfies ExportedHandler<Env>;
