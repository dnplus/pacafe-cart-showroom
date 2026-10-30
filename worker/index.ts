import type { Env } from './env';

// The Workers runtime binds the Durable Object class by name (wrangler.jsonc `class_name`), so the entry module exports it.
export { Showroom } from './showroom';

export default {
  async fetch(request, env) {
    const { pathname } = new URL(request.url);
    if (pathname === '/api/cart' || pathname === '/mcp') return env.SHOWROOM.get(env.SHOWROOM.idFromName('default')).fetch(request);
    if (pathname.startsWith('/api/')) return Response.json({ error: 'not_found' }, { status: 404 });
    return env.ASSETS.fetch(request);
  },
} satisfies ExportedHandler<Env>;
