import { isFinished, promoJobId, type PromoRecord } from '../shared/promo';
import { PROMO_STEPS, promoMediaKey, RUNNER_CLAIM_HEADER, RUNNER_LEASE_MS, RUNNER_MEDIA, runnerUpdateSchema, type PromoStatus, type RunnerClaim, type RunnerMedia, type RunnerUpdate } from '../shared/runner';
import { shareView } from '../shared/share';
import { hasToken, unauthorized } from './auth';
import type { Env } from './env';
import { json, notAllowed, parseBody } from './http';
import { mediaUrl } from './media';
import type { Store } from './tools';
import type { VoiceConfig } from '../shared/voice';

/** One uploaded file; a 45 s 1080p render with its voice is a few MB. */
export const MAX_MEDIA_BYTES = 50 * 1024 * 1024;

const leaseFrom = (now: number) => new Date(now + RUNNER_LEASE_MS).toISOString();
/** Waiting, or held by a runner that has been quiet past its lease and so is presumed gone. */
const claimable = ({ job, lease }: PromoRecord, now: number) => job.status === 'queued' || (!isFinished(job) && (!lease || Date.parse(lease.until) <= now));

/**
 * Hands the oldest claimable job to a runner under a new claimId and starts it over from storyboard, so a job whose runner died
 * is made again from the top. Two calls in a row never give the same job twice: the first renews its lease. The video is made
 * from the owner's price choice and nickname whether or not sharing is on. The claim is saved before anything is awaited, so
 * the job read from the queue is still the stored one; the earlier claim's files are dropped after.
 */
async function claimNext(store: Store, media: R2Bucket, now = Date.now(), voice: VoiceConfig | null = null): Promise<RunnerClaim | null> {
  const record = (await store.promoQueue()).find(candidate => claimable(candidate, now));
  if (!record) return null;
  const at = new Date(now).toISOString(), until = leaseFrom(now), claimId = crypto.randomUUID();
  const claimed: PromoRecord = { ...record, job: { ...record.job, status: 'storyboard', progress: 0, output: null, error: null, updatedAt: at }, lease: { id: claimId, claimedAt: at, until } };
  await store.savePromo(claimed);
  const earlier = record.lease;
  if (earlier) await media.delete(Object.keys(RUNNER_MEDIA).map(name => promoMediaKey(record.job.id, earlier.id, name as RunnerMedia)));
  return { job: claimed.job, view: shareView(claimed.cart, await store.share()), leaseUntil: until, claimId, voice };
}

type Refused = { refused: { status: 400 | 404 | 409 | 413; body: object } };
type Outcome<T> = { ok: T } | Refused;
const refuse = (status: Refused['refused']['status'], error: string, detail: object = {}): Refused => ({ refused: { status, body: { error, ...detail } } });
const reply = (outcome: Outcome<object>) => 'ok' in outcome ? json(outcome.ok) : json(outcome.refused.body, outcome.refused.status);

/** The job as stored now, when `claimId` still holds it and PROMO_STEPS lets it move to `to`. */
async function held(store: Store, id: string, claimId: string, to: PromoStatus): Promise<Outcome<PromoRecord>> {
  const record = await store.promo(id);
  if (!record) return refuse(404, 'not_found');
  if (record.lease?.id !== claimId) return refuse(409, 'stale_claim');
  if (!PROMO_STEPS[record.job.status].includes(to)) return refuse(409, 'invalid_step', { from: record.job.status, to });
  return { ok: record };
}

/**
 * Applies a runner's report to a job. Within one status progress only moves forward: a repeated or late report keeps the value
 * already stored instead of failing, since the runner cannot tell a duplicate from a mistake. Done is checked against the bucket,
 * so a done job always has this claim's video and thumbnail. The record is read after the body, and read again after the bucket
 * check, because both awaits let other requests run: what is saved is never older than what was checked.
 */
async function update(store: Store, env: Env, id: string, claimId: string, change: RunnerUpdate, origin: string, now = Date.now()): Promise<Outcome<PromoRecord['job']>> {
  let checked = await held(store, id, claimId, change.status);
  if ('refused' in checked) return checked;
  const keys = (['video.mp4', 'thumbnail.jpg'] as const).map(name => promoMediaKey(id, claimId, name));
  if (change.status === 'done') {
    const missing = (await Promise.all(keys.map(async key => await env.MEDIA.head(key) ? null : key))).filter(key => key !== null);
    checked = await held(store, id, claimId, change.status);
    if ('refused' in checked) return checked;
    if (missing.length) return refuse(409, 'missing_media', { missing });
  }
  const record = checked.ok, { job } = record, at = new Date(now).toISOString();
  let next: PromoRecord['job'] = { ...job, status: change.status, costUsd: change.costUsd, updatedAt: at };
  switch (change.status) {
    case 'storyboard': case 'voice': case 'rendering':
      next = { ...next, progress: change.status === job.status ? Math.max(job.progress, change.progress) : change.progress };
      break;
    case 'done':
      next = { ...next, progress: 1, output: { videoUrl: mediaUrl(origin, keys[0]), thumbnailUrl: mediaUrl(origin, keys[1]), ...change.video } };
      break;
    case 'failed': next = { ...next, error: change.error }; break;
  }
  await store.savePromo({ ...record, job: next, lease: isFinished(next) ? record.lease : { id: claimId, claimedAt: record.lease?.claimedAt ?? at, until: leaseFrom(now) } });
  return { ok: next };
}

/** The whole file, or null once the body passes the cap; reads no further than the cap. */
async function readFile(request: Request) {
  if (Number(request.headers.get('content-length')) > MAX_MEDIA_BYTES) return null;
  const chunks: Uint8Array[] = [], reader = request.body?.getReader();
  let size = 0;
  while (reader) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > MAX_MEDIA_BYTES) { await reader.cancel(); return null; }
    chunks.push(value);
  }
  const file = new Uint8Array(size);
  let at = 0;
  for (const chunk of chunks) { file.set(chunk, at); at += chunk.byteLength; }
  return file;
}

/** Stored under the claim, so a put that lands after the job was claimed again is never what done finds. */
async function upload(request: Request, env: Env, record: PromoRecord, claimId: string, name: RunnerMedia, origin: string): Promise<Outcome<{ key: string; url: string }>> {
  if (record.lease?.id !== claimId) return refuse(409, 'stale_claim');
  if (record.job.status === 'queued' || isFinished(record.job)) return refuse(409, 'job_not_running', { status: record.job.status });
  const bytes = await readFile(request);
  if (!bytes) return refuse(413, 'file_too_large', { maxBytes: MAX_MEDIA_BYTES });
  if (bytes.length === 0) return refuse(400, 'empty_file');
  const key = promoMediaKey(record.job.id, claimId, name);
  await env.MEDIA.put(key, bytes, { httpMetadata: { contentType: RUNNER_MEDIA[name] } });
  return { ok: { key, url: mediaUrl(origin, key) } };
}

const jobPath = /^\/runner\/jobs\/([^/]+)(?:\/media\/([^/]+))?$/;

/** `/runner/*`, the promo runner's side of shared/runner.ts. Every route needs the token, env.local included. */
export async function runnerApi(request: Request, env: Env, store: Store, pathname: string, voice: () => Promise<VoiceConfig | null> = async () => null) {
  if (!hasToken(request, env)) return unauthorized();
  const origin = new URL(request.url).origin;
  if (pathname === '/runner/next') {
    if (request.method !== 'POST') return notAllowed('POST');
    const claim = await claimNext(store, env.MEDIA, Date.now(), await voice());
    return claim ? json(claim) : new Response(null, { status: 204, headers: { 'cache-control': 'no-store' } });
  }
  const match = jobPath.exec(pathname);
  if (!match || !promoJobId.safeParse(match[1]).success) return json({ error: 'not_found' }, 404);
  const [, id, name] = match;
  if (name !== undefined && !Object.hasOwn(RUNNER_MEDIA, name)) return json({ error: 'not_found' }, 404);
  if (request.method !== (name === undefined ? 'POST' : 'PUT')) return notAllowed(name === undefined ? 'POST' : 'PUT');
  const claimId = request.headers.get(RUNNER_CLAIM_HEADER) ?? '';
  if (name !== undefined) {
    const record = await store.promo(id);
    return record ? reply(await upload(request, env, record, claimId, name as RunnerMedia, origin)) : json({ error: 'not_found' }, 404);
  }
  const body = await parseBody(request, runnerUpdateSchema);
  return body instanceof Response ? body : reply(await update(store, env, id, claimId, body.data, origin));
}
