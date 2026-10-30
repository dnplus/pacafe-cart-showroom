import { castSchema, castUpdateSchema, CAST_KEY, type Cast, type CastView } from '../shared/cast';
import { isOwner, unauthorized } from './auth';
import type { Env } from './env';

/** The owner's cast routes, which the entry worker forwards to the Showroom. */
export const castPath = /^\/api\/cast(?:\/owner-sprite)?$/;
const json = (body: unknown, status = 200, headers: Record<string, string> = {}) => Response.json(body, { status, headers: { 'cache-control': 'no-store', ...headers } });

export interface CastDeps {
  storage: Pick<DurableObjectStorage, 'get' | 'put'>;
  env: Env;
  /** The nickname on the owner's share settings, for the nameplate; the default when sharing was never set up. */
  nickname(): Promise<string>;
}

export async function readCast({ storage }: CastDeps): Promise<Cast> {
  return castSchema.parse(await storage.get(CAST_KEY) ?? {});
}

async function view(deps: CastDeps): Promise<CastView> {
  const { env } = deps;
  return { ...await readCast(deps), nickname: await deps.nickname(), spriteGeneration: env.META_API_KEY && env.META_API_BASE_URL ? { available: true } : { available: false, reason: 'needs_meta_api_key' } };
}

/** `/api/cast`: the owner's choices of clerk and of the figure at the room's centre. Nothing here is reachable from `/s/<slug>`. */
export async function handleCast(request: Request, deps: CastDeps): Promise<Response> {
  const { pathname } = new URL(request.url);
  if (pathname !== '/api/cast') return json({ error: 'not_found' }, 404);
  if (request.method !== 'GET' && request.method !== 'PUT') return json({ error: 'method_not_allowed' }, 405, { allow: 'GET, PUT' });
  if (!isOwner(request, deps.env)) return unauthorized();
  if (request.method === 'GET') return json(await view(deps));
  const sent = await request.json().then((body: unknown) => ({ body }), () => null);
  if (!sent) return json({ error: 'invalid_json' }, 400);
  const parsed = castUpdateSchema.safeParse(sent.body);
  if (!parsed.success) return json({ error: 'invalid_body', issues: parsed.error.issues.map(issue => ({ path: issue.path.join('.'), message: issue.message })) }, 400);
  await deps.storage.put(CAST_KEY, { ...await readCast(deps), ...parsed.data });
  return json(await view(deps));
}
