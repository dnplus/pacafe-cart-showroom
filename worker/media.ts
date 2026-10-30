import { isOwner, unauthorized } from './auth';
import type { Env } from './env';

/**
 * Who may read a stored object, by the first segment of its key. A promo's files are open to anyone holding its
 * unguessable job id, like a share slug; the owner's files (the generated sprite) need the owner key.
 */
const readers = { promo: 'anyone', owner: 'owner' } as const;
type Area = keyof typeof readers;
const mediaPath = /^\/media\/((promo|owner)\/[A-Za-z0-9_-][A-Za-z0-9._-]*(?:\/[A-Za-z0-9_-][A-Za-z0-9._-]*)*)$/;

export const mediaUrl = (origin: string, key: string) => `${origin}/media/${key}`;

/** GET or HEAD `/media/<area>/<path>` from the MEDIA bucket, with byte ranges so a video can seek. */
export async function serveMedia(request: Request, env: Env) {
  if (request.method !== 'GET' && request.method !== 'HEAD') return Response.json({ error: 'method_not_allowed' }, { status: 405, headers: { allow: 'GET, HEAD' } });
  const match = mediaPath.exec(new URL(request.url).pathname);
  if (!match) return Response.json({ error: 'not_found' }, { status: 404 });
  const key = match[1], area = match[2] as Area;
  if (readers[area] === 'owner' && !isOwner(request, env)) return unauthorized();
  const object = await env.MEDIA.get(key, { range: request.headers });
  if (!object) return Response.json({ error: 'not_found' }, { status: 404 });
  const headers = new Headers({ 'cache-control': readers[area] === 'owner' ? 'private, no-store' : 'public, max-age=300', 'accept-ranges': 'bytes', etag: object.httpEtag });
  object.writeHttpMetadata(headers);
  const range = object.range as { offset: number; length: number } | undefined;
  const body = request.method === 'HEAD' ? null : object.body;
  if (!range || !request.headers.has('range')) return new Response(body, { headers });
  headers.set('content-range', `bytes ${range.offset}-${range.offset + range.length - 1}/${object.size}`);
  return new Response(body, { status: 206, headers });
}
