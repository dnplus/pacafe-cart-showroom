import { castSchema, castUpdateSchema, CAST_KEY, MAX_PHOTO_BYTES, sniffPhotoType, type Cast, type CastView } from '../shared/cast';
import { isOwner, unauthorized } from './auth';
import type { Env } from './env';
import { json, notAllowed, parseBody, readOr } from './http';
import { requestSprite, SpriteError, SPRITE_MODEL } from './ownerSprite';

export const castPath = /^\/api\/cast(?:\/owner-sprite)?$/;
/** Room for the multipart framing and the consent field around a photo of MAX_PHOTO_BYTES. */
const FORM_OVERHEAD = 16 * 1024;

export interface CastDeps {
  storage: Pick<DurableObjectStorage, 'get' | 'put'>;
  env: Env;
  /** The nickname on the owner's share settings, for the nameplate; the default when sharing was never set up. */
  nickname(): Promise<string>;
}

const readCast = ({ storage }: CastDeps): Promise<Cast> => readOr(storage, CAST_KEY, castSchema, castSchema.parse({}));

const canGenerate = (env: Env): env is Env & { META_API_KEY: string; META_API_BASE_URL: string } => Boolean(env.META_API_KEY && env.META_API_BASE_URL);

async function view(deps: CastDeps): Promise<CastView> {
  return { ...await readCast(deps), nickname: await deps.nickname(), spriteGeneration: canGenerate(deps.env) ? { available: true } : { available: false, reason: 'needs_meta_api_key' } };
}

/** Draws the owner's sprite from the photo in the form. The photo is read, sent to the model and dropped: it is never stored. */
async function generate(request: Request, deps: CastDeps): Promise<Response> {
  const { env } = deps;
  if (!canGenerate(env)) return json({ error: 'needs_meta_api_key' }, 503);
  if (Number(request.headers.get('content-length')) > MAX_PHOTO_BYTES + FORM_OVERHEAD) return json({ error: 'photo_too_large' }, 413);
  const form = await request.formData().catch(() => null);
  if (!form) return json({ error: 'invalid_form' }, 400);
  if (form.get('consent') !== 'true') return json({ error: 'consent_required' }, 400);
  const photo = form.get('photo');
  if (!(photo instanceof File)) return json({ error: 'photo_required' }, 400);
  if (photo.size > MAX_PHOTO_BYTES) return json({ error: 'photo_too_large' }, 413);
  const bytes = new Uint8Array(await photo.arrayBuffer()), type = sniffPhotoType(bytes);
  if (!type) return json({ error: 'photo_must_be_jpeg_or_png' }, 400);
  let sprite: Uint8Array;
  try { sprite = await requestSprite(env, { bytes, type }); } catch (error) {
    // Only our own reason is logged: neither the key nor anything the upstream said gets out.
    console.warn('owner sprite generation failed:', error instanceof SpriteError ? error.message : 'unexpected');
    return json({ error: 'generation_failed' }, 502);
  }
  const generatedAt = new Date().toISOString(), key = `owner/sprite-${crypto.randomUUID()}.png`;
  await env.MEDIA.put(key, sprite, { httpMetadata: { contentType: 'image/png' }, customMetadata: { aiGenerated: 'true', model: SPRITE_MODEL, generatedAt, enableImageSearch: 'false' } });
  const before = await readCast(deps);
  await deps.storage.put(CAST_KEY, { ...before, owner: { kind: 'generated', key, generatedAt, model: SPRITE_MODEL } } satisfies Cast);
  if (before.owner.kind === 'generated') await env.MEDIA.delete(before.owner.key);
  return json(await view(deps));
}

/** Back to the stand-in figure; the sprite the owner had is deleted with it. */
async function revert(deps: CastDeps): Promise<Response> {
  const before = await readCast(deps);
  await deps.storage.put(CAST_KEY, { ...before, owner: { kind: 'placeholder' } } satisfies Cast);
  if (before.owner.kind === 'generated') await deps.env.MEDIA.delete(before.owner.key);
  return json(await view(deps));
}

/** `/api/cast`: the owner's choices of clerk and of the figure at the room's centre. Nothing here is reachable from `/s/<slug>`. */
export async function handleCast(request: Request, deps: CastDeps): Promise<Response> {
  const { pathname } = new URL(request.url), sprite = pathname === '/api/cast/owner-sprite';
  if (!castPath.test(pathname)) return json({ error: 'not_found' }, 404);
  const allowed = sprite ? ['POST', 'DELETE'] : ['GET', 'PUT'];
  if (!allowed.includes(request.method)) return notAllowed(...allowed);
  if (!isOwner(request, deps.env)) return unauthorized();
  if (sprite) return request.method === 'POST' ? generate(request, deps) : revert(deps);
  if (request.method === 'GET') return json(await view(deps));
  const body = await parseBody(request, castUpdateSchema);
  if (body instanceof Response) return body;
  await deps.storage.put(CAST_KEY, { ...await readCast(deps), ...body.data });
  return json(await view(deps));
}
