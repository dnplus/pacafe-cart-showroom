import { scriptProblems } from '../shared/script';
import { shareView } from '../shared/share';
import { promoRequestSchema, queuedPromoJob, type PromoJob, type PromoRequest } from '../shared/promo';
import { isOwner, unauthorized } from './auth';
import type { Env } from './env';
import { invalidBody, json, readJson } from './http';
import type { Store } from './tools';

/** A script that does not fit this cart; `problems` are sentences Muse can act on. */
export class ScriptRefused extends Error {
  constructor(readonly problems: string[]) { super(problems.join('；')); }
}

/**
 * Queues a video for the cart as it is now, or hands back the one already waiting for exactly this cart and request, so a
 * retried call never queues a second paid render. Null for an empty cart. Shared by the MCP tool and the room's button.
 */
export async function queuePromo(store: Store, request: PromoRequest, now = new Date().toISOString()): Promise<PromoJob | null> {
  const cart = await store.cart();
  if (cart.items.length === 0) return null;
  if (request.script) {
    const problems = scriptProblems(request.script, shareView(cart, await store.share()), request.durationSec);
    if (problems.length) throw new ScriptRefused(problems);
  }
  const latest = (await store.latestPromo())?.job;
  if (latest?.status === 'queued' && latest.cartRevision === cart.revision && latest.durationSec === request.durationSec && latest.style === (request.style ?? null) && JSON.stringify(latest.script) === JSON.stringify(request.script ?? null)) return latest;
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
  let job: PromoJob | null;
  try { job = await queuePromo(store, parsed.data); } catch (error) {
    if (error instanceof ScriptRefused) return json({ error: 'invalid_script', problems: error.problems }, 400);
    throw error;
  }
  return job ? json({ jobId: job.id, status: job.status }) : json({ error: 'empty_cart' }, 409);
}
