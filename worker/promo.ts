import { promoRequestSchema, queuedPromoJob, type PromoJob, type PromoRequest } from '../shared/promo';
import { isOwner, unauthorized } from './auth';
import type { Env } from './env';
import { invalidBody, json, readJson } from './http';
import type { Store } from './tools';

/**
 * Queues a video for the cart as it is now, or hands back the one already waiting for exactly this cart and request, so a
 * retried call never queues a second paid render. Null for an empty cart. Shared by the MCP tool and the room's button.
 */
export async function queuePromo(store: Store, request: PromoRequest, now = new Date().toISOString()): Promise<PromoJob | null> {
  const cart = await store.cart();
  if (cart.items.length === 0) return null;
  const latest = (await store.latestPromo())?.job;
  if (latest?.status === 'queued' && latest.cartRevision === cart.revision && latest.durationSec === request.durationSec && latest.style === (request.style ?? null)) return latest;
  const job = queuedPromoJob(`promo-${crypto.randomUUID()}`, cart, request, now);
  await store.queuePromo({ job, cart });
  return job;
}

/** `/api/promo` for the owner's room: GET the latest job (or null), POST to queue one. */
export async function promoApi(request: Request, env: Env, store: Store) {
  if (request.method !== 'GET' && request.method !== 'POST') return json({ error: 'method_not_allowed' }, 405, { allow: 'GET, POST' });
  if (!isOwner(request, env)) return unauthorized();
  if (request.method === 'GET') return json((await store.latestPromo())?.job ?? null);
  const sent = await readJson(request);
  if (!sent) return json({ error: 'invalid_json' }, 400);
  const parsed = promoRequestSchema.safeParse(sent.body);
  if (!parsed.success) return invalidBody(parsed.error);
  const job = await queuePromo(store, parsed.data);
  return job ? json({ jobId: job.id, status: job.status }) : json({ error: 'empty_cart' }, 409);
}
