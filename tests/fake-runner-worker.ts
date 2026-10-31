import http from 'node:http';
import { emptyCart, replaceCart, type CartItemInput } from '../shared/cart.ts';
import { queuedPromoJob, type PromoJob, type PromoLanguage } from '../shared/promo.ts';
import type { PromoScript } from '../shared/script.ts';
import { PROMO_STEPS, RUNNER_CLAIM_HEADER, RUNNER_LEASE_MS, RUNNER_MEDIA, runnerUpdateSchema, type RunnerClaim, type RunnerMedia, type RunnerUpdate } from '../shared/runner.ts';
import { shareView, type PriceMode } from '../shared/share.ts';

/** A queued job and its view, as `/runner/next` would hand them out for this cart. */
export function claimFor(items: readonly CartItemInput[], prices: PriceMode, durationSec = 30, script?: PromoScript, language: PromoLanguage = 'zh-TW'): RunnerClaim {
  const now = new Date().toISOString(), cart = replaceCart(emptyCart(), items, now);
  return {
    job: queuedPromoJob(`promo-${crypto.randomUUID()}`, cart, { durationSec, language, script }, now),
    view: shareView(cart, { slug: 'a'.repeat(22), enabled: false, prices, nickname: '小島' }),
    leaseUntil: new Date(Date.now() + RUNNER_LEASE_MS).toISOString(),
    claimId: crypto.randomUUID(),
    voice: null,
  };
}

/**
 * The worker's half of shared/runner.ts over real HTTP, holding the rules the contract states: Bearer token, the claim's id on
 * every job route, PROMO_STEPS, uploads only while a job runs, done only after the video and thumbnail are in. Not the worker's code; a stand-in for it.
 */
export async function fakeRunnerWorker(token: string, claims: readonly RunnerClaim[]) {
  const queue = [...claims], jobs = new Map<string, PromoJob>(), claimIds = new Map<string, string>();
  const updates: { jobId: string; update: RunnerUpdate }[] = [];
  const uploads = new Map<string, Buffer>();
  const running = (job: PromoJob) => job.status !== 'done' && job.status !== 'failed';
  const server = http.createServer(async (request, response) => {
    const send = (status: number, body?: unknown) => { response.writeHead(status, body === undefined ? {} : { 'content-type': 'application/json' }); response.end(body === undefined ? undefined : JSON.stringify(body)); };
    const chunks: Buffer[] = [];
    for await (const chunk of request) chunks.push(chunk as Buffer);
    const body = Buffer.concat(chunks);
    if (request.headers.authorization !== `Bearer ${token}`) return send(401, { error: 'unauthorized' });
    const url = new URL(request.url!, 'http://fake');
    if (request.method === 'POST' && url.pathname === '/runner/next') {
      const claim = queue.shift();
      if (!claim) return send(204);
      const job = { ...claim.job, status: 'storyboard' as const };
      jobs.set(job.id, job);
      claimIds.set(job.id, claim.claimId);
      return send(200, { ...claim, job });
    }
    const jobId = /^\/runner\/jobs\/([^/]+)/.exec(url.pathname)?.[1];
    if (jobId && jobs.has(jobId) && request.headers[RUNNER_CLAIM_HEADER] !== claimIds.get(jobId)) return send(409, { error: 'stale_claim' });
    const media = /^\/runner\/jobs\/([^/]+)\/media\/([^/]+)$/.exec(url.pathname);
    if (request.method === 'PUT' && media) {
      const job = jobs.get(media[1]);
      if (!job) return send(404, { error: 'not_found' });
      if (!(media[2] in RUNNER_MEDIA) || !running(job)) return send(409, { error: 'conflict' });
      uploads.set(`${job.id}/${media[2]}`, body);
      return send(200, { key: `promo/${job.id}/${media[2]}`, url: `${origin}/media/promo/${job.id}/${media[2]}` });
    }
    const update = /^\/runner\/jobs\/([^/]+)$/.exec(url.pathname);
    if (request.method === 'POST' && update) {
      const job = jobs.get(update[1]);
      if (!job) return send(404, { error: 'not_found' });
      const parsed = runnerUpdateSchema.safeParse(JSON.parse(body.toString() || 'null'));
      if (!parsed.success) return send(400, { error: 'bad_request' });
      const next = parsed.data;
      if (!PROMO_STEPS[job.status].includes(next.status)) return send(409, { error: 'conflict' });
      const has = (name: RunnerMedia) => uploads.has(`${job.id}/${name}`);
      if (next.status === 'done' && !(has('video.mp4') && has('thumbnail.jpg'))) return send(409, { error: 'conflict' });
      updates.push({ jobId: job.id, update: next });
      const moved: PromoJob = next.status === 'done' ? { ...job, status: 'done', progress: 1, costUsd: next.costUsd, output: { videoUrl: `${origin}/media/promo/${job.id}/video.mp4`, thumbnailUrl: `${origin}/media/promo/${job.id}/thumbnail.jpg`, ...next.video } }
        : next.status === 'failed' ? { ...job, status: 'failed', costUsd: next.costUsd, error: next.error }
        : { ...job, status: next.status, progress: next.progress, costUsd: next.costUsd };
      jobs.set(job.id, moved);
      return send(200, moved);
    }
    send(404, { error: 'not_found' });
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  return { origin, jobs, updates, uploads, close: () => new Promise<void>(resolve => { server.closeAllConnections(); server.close(() => resolve()); }) };
}
