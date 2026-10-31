import { afterEach, describe, expect, it, vi } from 'vitest';
import { promoJobSchema, type PromoJob } from '../shared/promo';
import { RUNNER_LEASE_MS, runnerClaimSchema, type RunnerUpdate } from '../shared/runner';
import type { Env } from '../worker/env';
import worker from '../worker/index';
import { MAX_MEDIA_BYTES } from '../worker/runner';
import { Showroom } from '../worker/showroom';
import { memoryBucket, memoryState } from './memory-state';

const token = 'test-token-0123456789';
const origin = 'https://showroom.test';
const auth = { authorization: `Bearer ${token}` };
const sha256 = 'a'.repeat(64);
const video = new Uint8Array([0, 0, 0, 24, 102, 116, 121, 112]);
const thumbnail = new Uint8Array([255, 216, 255, 224]);

/** The real worker over one real Showroom whose storage and bucket live in memory, with the production gate: a token and no open owner access. */
function world(vars: Partial<Env> = { CART_MCP_TOKEN: token }) {
  const state = memoryState(), MEDIA = memoryBucket();
  const env = { ...vars, MEDIA, SHOWROOM: { idFromName: (name: string) => name, get: () => new Showroom(state, env) }, ASSETS: { fetch: async () => new Response('app') } } as unknown as Env;
  const send = (path: string, init?: RequestInit) => worker.fetch(new Request(`${origin}${path}`, init) as Parameters<typeof worker.fetch>[0], env);
  const json = (body: unknown) => ({ body: JSON.stringify(body), headers: { ...auth, 'content-type': 'application/json' } });
  const cartAdd = (item: object) => call('cart_add', item);
  let rpcId = 1;
  const call = async (name: string, args: unknown = {}) => {
    const response = await send('/mcp', { method: 'POST', ...json({ jsonrpc: '2.0', id: rpcId++, method: 'tools/call', params: { name, arguments: args } }) });
    return (await response.json() as any).result;
  };
  const next = () => send('/runner/next', { method: 'POST', headers: auth });
  const claim = async () => runnerClaimSchema.parse(await (await next()).json());
  const report = (id: string, update: RunnerUpdate | object) => send(`/runner/jobs/${id}`, { method: 'POST', ...json(update) });
  const upload = (id: string, name: string, bytes: Uint8Array) => send(`/runner/jobs/${id}/media/${name}`, { method: 'PUT', headers: auth, body: bytes as BodyInit });
  const progress = (status: 'storyboard' | 'voice' | 'rendering', value: number): RunnerUpdate => ({ status, progress: value, costUsd: 0.12 });
  const done: RunnerUpdate = { status: 'done', costUsd: 0.4, video: { sha256, durationSec: 29.5 } };
  const room = (path: string, init: RequestInit = {}) => send(path, { ...init, headers: { ...auth, ...init.headers as Record<string, string> } });
  const status = async (jobId: string) => promoJobSchema.parse((await call('promo_status', { jobId })).structuredContent);
  const queue = async (args: object = {}) => (await call('promo_generate', args)).structuredContent.jobId as string;
  return { send, next, claim, report, upload, progress, done, cartAdd, call, room, status, queue, MEDIA, json };
}

const priceKeys = ['priceTwd', 'totalTwd', 'priceRange', 'totalRange'];
afterEach(() => { vi.useRealTimers(); });

describe('/runner', () => {
  it('refuses every route without the token, even where env.local opens owner access', async () => {
    for (const vars of [{ CART_MCP_TOKEN: token }, { CART_MCP_TOKEN: token, OPEN_OWNER_ACCESS: 'true' }, { OPEN_OWNER_ACCESS: 'true' }] as Partial<Env>[]) {
      const { send } = world(vars);
      const id = 'promo-00000000-0000-4000-8000-000000000000';
      for (const [path, method] of [['/runner/next', 'POST'], [`/runner/jobs/${id}`, 'POST'], [`/runner/jobs/${id}/media/video.mp4`, 'PUT']]) {
        for (const headers of [{}, { authorization: 'Bearer test-token-0123456780' }] as Record<string, string>[]) {
          const response = await send(path, { method, headers });
          expect(response.status).toBe(401);
          expect(response.headers.get('www-authenticate')).toBe('Bearer');
        }
      }
    }
  });

  it('answers 204 when nothing waits', async () => {
    const { next, call, cartAdd } = world();
    const idle = await next();
    expect(idle.status).toBe(204);
    expect(await idle.text()).toBe('');
    await cartAdd({ title: 'pen' });
    await call('promo_generate');
    expect((await next()).status).toBe(200);
    expect((await next()).status).toBe(204);
  });

  it('claims the oldest queued job and moves it to storyboard', async () => {
    const { cartAdd, queue, claim, status } = world();
    await cartAdd({ title: 'pen', priceTwd: 25 });
    const id = await queue({ durationSec: 20, style: '溫暖' });
    const claimed = await claim();
    expect(claimed.job).toMatchObject({ id, status: 'storyboard', progress: 0, durationSec: 20, style: '溫暖', output: null, error: null });
    expect(Date.parse(claimed.leaseUntil)).toBeGreaterThan(Date.now() + RUNNER_LEASE_MS - 5000);
    expect(await status(id)).toEqual(claimed.job);
    expect(Object.keys(await status(id)).sort()).toEqual(Object.keys(claimed.job).sort());
  });

  it('shows the video only what the owner chose to share, whether or not sharing is on', async () => {
    const hidden = world();
    await hidden.cartAdd({ title: '陶瓷馬克杯', priceTwd: 420, qty: 2 });
    await hidden.queue();
    const asHidden = await hidden.claim();
    expect(asHidden.view).toMatchObject({ mode: 'hidden', nickname: '屋主' });
    expect(JSON.stringify(asHidden)).not.toMatch(new RegExp(priceKeys.join('|')));
    expect(JSON.stringify(asHidden)).not.toContain('420');

    for (const [prices, field] of [['range', 'totalRange'], ['exact', 'totalTwd']] as const) {
      const { cartAdd, queue, claim, room, json } = world();
      await cartAdd({ title: '陶瓷馬克杯', priceTwd: 420, qty: 2 });
      expect((await room('/api/share', { method: 'PUT', ...json({ enabled: false, prices, nickname: '小島' }) })).status).toBe(200);
      await queue();
      const { view } = await claim();
      expect(view).toMatchObject({ mode: prices, nickname: '小島' });
      expect((view as Record<string, unknown>)[field]).toBeTruthy();
    }
  });

  it('shows the video the cart as it was queued', async () => {
    const { cartAdd, queue, claim } = world();
    await cartAdd({ title: 'pen' });
    await queue();
    await cartAdd({ title: 'cup' });
    expect((await claim()).view.items.map(item => item.title)).toEqual(['pen']);
  });

  it('takes a job through voice and rendering to done, with URLs for the files it uploaded', async () => {
    const { cartAdd, queue, claim, report, upload, progress, done, status, MEDIA, send, call } = world();
    await cartAdd({ title: 'pen' });
    const id = await queue();
    await claim();
    expect((await report(id, progress('storyboard', 0.5))).status).toBe(200);
    expect((await report(id, progress('voice', 0.25))).status).toBe(200);
    const rendering = promoJobSchema.parse(await (await report(id, progress('rendering', 0.6))).json());
    expect(rendering).toMatchObject({ status: 'rendering', progress: 0.6, costUsd: 0.12, output: null });

    expect((await upload(id, 'video.mp4', video)).status).toBe(200);
    const thumb = await (await upload(id, 'thumbnail.jpg', thumbnail)).json() as { key: string; url: string };
    expect(thumb).toEqual({ key: `promo/${id}/thumbnail.jpg`, url: `${origin}/media/promo/${id}/thumbnail.jpg` });
    expect((await MEDIA.head(`promo/${id}/video.mp4`)) && (await MEDIA.get(`promo/${id}/video.mp4`).then(object => object?.httpMetadata?.contentType))).toBe('video/mp4');

    const finished = promoJobSchema.parse(await (await report(id, done)).json());
    expect(finished).toMatchObject({ status: 'done', progress: 1, costUsd: 0.4, error: null, output: { videoUrl: `${origin}/media/promo/${id}/video.mp4`, thumbnailUrl: `${origin}/media/promo/${id}/thumbnail.jpg`, sha256, durationSec: 29.5 } });
    expect(await status(id)).toEqual(finished);
    const served = await send(new URL(finished.output!.videoUrl).pathname);
    expect([...new Uint8Array(await served.arrayBuffer())]).toEqual([...video]);
    expect(await call('promo_status', { jobId: id })).toMatchObject({ isError: false });
  });

  it('refuses done until both the video and the thumbnail are uploaded', async () => {
    const { cartAdd, queue, claim, report, upload, progress, done, status } = world();
    await cartAdd({ title: 'pen' });
    const id = await queue();
    await claim(); await report(id, progress('voice', 1)); await report(id, progress('rendering', 0.9));
    const none = await report(id, done);
    expect(none.status).toBe(409);
    expect(await none.json()).toMatchObject({ error: 'missing_media', missing: [`promo/${id}/video.mp4`, `promo/${id}/thumbnail.jpg`] });
    await upload(id, 'video.mp4', video);
    expect((await report(id, done)).status).toBe(409);
    expect((await status(id)).status).toBe('rendering');
    await upload(id, 'thumbnail.jpg', thumbnail);
    expect((await report(id, done)).status).toBe(200);
  });

  it('refuses a step the status table does not allow, and a body that is not an update', async () => {
    const { cartAdd, queue, claim, report, progress, done, upload, status } = world();
    await cartAdd({ title: 'pen' });
    const id = await queue();
    expect((await report(id, progress('voice', 0))).status).toBe(409);
    await claim();
    const skipped = await report(id, progress('rendering', 0));
    expect(skipped.status).toBe(409);
    expect(await skipped.json()).toMatchObject({ error: 'invalid_step', from: 'storyboard', to: 'rendering' });
    expect((await report(id, done)).status).toBe(409);
    await report(id, progress('voice', 0.5));
    expect((await report(id, progress('storyboard', 0.5))).status).toBe(409);
    expect((await status(id)).status).toBe('voice');

    expect((await report(id, { status: 'voice', progress: 2, costUsd: 0 })).status).toBe(400);
    expect((await report(id, { status: 'done', costUsd: 0 })).status).toBe(400);
    expect((await report(id, { status: 'queued', progress: 0, costUsd: 0 })).status).toBe(400);
    expect((await report('promo-00000000-0000-4000-8000-000000000000', progress('storyboard', 0))).status).toBe(404);
    expect((await report('not-a-job', progress('storyboard', 0))).status).toBe(404);

    const failed = promoJobSchema.parse(await (await report(id, { status: 'failed', costUsd: 0.3, error: 'voice quota exhausted' })).json());
    expect(failed).toMatchObject({ status: 'failed', error: 'voice quota exhausted', costUsd: 0.3, output: null });
    expect((await report(id, progress('voice', 0.9))).status).toBe(409);
    expect((await upload(id, 'video.mp4', video)).status).toBe(409);
  });

  it('keeps the furthest progress a status has reached', async () => {
    const { cartAdd, queue, claim, report, progress } = world();
    await cartAdd({ title: 'pen' });
    const id = await queue();
    await claim();
    await report(id, progress('storyboard', 0.7));
    const late = await report(id, progress('storyboard', 0.3));
    expect(late.status).toBe(200);
    expect((await late.json() as PromoJob).progress).toBe(0.7);
    expect(((await (await report(id, progress('voice', 0.1))).json()) as PromoJob).progress).toBe(0.1);
  });

  it('offers a job again only once its runner has been quiet past the lease', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    const { cartAdd, queue, claim, next, report, progress, status } = world();
    await cartAdd({ title: 'pen' });
    const id = await queue();
    expect((await claim()).job.id).toBe(id);
    await report(id, progress('voice', 0.5));

    vi.advanceTimersByTime(RUNNER_LEASE_MS - 1000);
    expect((await next()).status).toBe(204);
    await report(id, progress('voice', 0.8));
    vi.advanceTimersByTime(RUNNER_LEASE_MS - 1000);
    expect((await next()).status).toBe(204);

    vi.advanceTimersByTime(2000);
    const again = await claim();
    expect(again.job).toMatchObject({ id, status: 'storyboard', progress: 0 });
    expect((await status(id)).status).toBe('storyboard');
    expect((await next()).status).toBe(204);
  });

  it('starts a reclaimed job without the files the earlier runner uploaded', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    const { cartAdd, queue, claim, report, upload, progress, done } = world();
    await cartAdd({ title: 'pen' });
    const id = await queue();
    await claim(); await report(id, progress('voice', 1)); await report(id, progress('rendering', 0.9));
    await upload(id, 'video.mp4', video); await upload(id, 'thumbnail.jpg', thumbnail);
    vi.advanceTimersByTime(RUNNER_LEASE_MS + 1000);
    await claim(); await report(id, progress('voice', 1)); await report(id, progress('rendering', 0.9));
    const stale = await report(id, done);
    expect(stale.status).toBe(409);
    expect(await stale.json()).toMatchObject({ error: 'missing_media' });
  });

  it('never offers a finished job again', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    const { cartAdd, queue, claim, next, report } = world();
    await cartAdd({ title: 'pen' });
    const id = await queue();
    await claim();
    await report(id, { status: 'failed', costUsd: 0, error: 'boom' });
    vi.advanceTimersByTime(RUNNER_LEASE_MS * 3);
    expect((await next()).status).toBe(204);
  });

  it('hands out queued jobs oldest first, one at a time', async () => {
    const { cartAdd, queue, claim, next, report } = world();
    await cartAdd({ title: 'pen' });
    const first = await queue({ durationSec: 30 }), second = await queue({ durationSec: 45 });
    await cartAdd({ title: 'cup' });
    const third = await queue({ durationSec: 45 });
    expect(new Set([first, second, third]).size).toBe(3);
    expect((await claim()).job.id).toBe(first);
    expect((await claim()).job.id).toBe(second);
    await report(second, { status: 'failed', costUsd: 0, error: 'boom' });
    expect((await claim()).job.id).toBe(third);
    expect((await next()).status).toBe(204);
  });

  it('takes a file only for a job that is running, under a known name and the size cap', async () => {
    const { cartAdd, queue, claim, upload, send, report, progress, MEDIA } = world();
    await cartAdd({ title: 'pen' });
    const id = await queue();
    expect((await upload(id, 'video.mp4', video)).status).toBe(409);
    await claim();
    expect((await upload(id, 'qa.json', new TextEncoder().encode('{"ok":true}'))).status).toBe(200);
    expect((await MEDIA.get(`promo/${id}/qa.json`))?.httpMetadata?.contentType).toBe('application/json');
    for (const name of ['audio.wav', '..%2Fvideo.mp4', 'video.MP4', 'constructor', 'toString']) expect((await upload(id, name, video)).status).toBe(404);
    expect((await upload('promo-00000000-0000-4000-8000-000000000000', 'video.mp4', video)).status).toBe(404);
    expect((await upload(id, 'video.mp4', new Uint8Array())).status).toBe(400);
    const tooBig = await upload(id, 'video.mp4', new Uint8Array(MAX_MEDIA_BYTES + 1));
    expect(tooBig.status).toBe(413);
    expect(await MEDIA.head(`promo/${id}/video.mp4`)).toBeNull();
    expect((await send(`/runner/jobs/${id}/media/video.mp4`, { method: 'POST', headers: auth })).status).toBe(405);
    expect((await send('/runner/next', { method: 'GET', headers: auth })).status).toBe(405);
    expect((await send('/runner/other', { method: 'POST', headers: auth })).status).toBe(404);
    await report(id, progress('voice', 0));
    expect((await upload(id, 'video.mp4', video)).status).toBe(200);
  });
});

describe('/api/promo', () => {
  it('queues the same job as promo_generate, and reads back the latest', async () => {
    const { cartAdd, queue, room, json, status } = world();
    await cartAdd({ title: 'pen' });
    expect(await (await room('/api/promo')).json()).toBeNull();
    const viaTool = await queue();
    const queued = await room('/api/promo', { method: 'POST', ...json({}) });
    expect(queued.status).toBe(200);
    expect(await queued.json()).toEqual({ jobId: viaTool, status: 'queued' });
    const latest = promoJobSchema.parse(await (await room('/api/promo')).json());
    expect(latest).toEqual(await status(viaTool));

    const longer = await (await room('/api/promo', { method: 'POST', ...json({ durationSec: 45 }) })).json() as { jobId: string };
    expect(longer.jobId).not.toBe(viaTool);
    expect((await queue({ durationSec: 45 }))).toBe(longer.jobId);
    expect((await room('/api/promo').then(response => response.json()) as PromoJob).id).toBe(longer.jobId);
  });

  describe('with a script from Muse', () => {
    const script = { opening: ['嗨，歡迎來到我的小屋。'], items: [{ position: 2, title: '降噪耳機', lines: ['通勤全靠它。'] }], ending: ['謝謝你來逛。'] };
    const stock = async (w: ReturnType<typeof world>) => { for (const item of [{ title: '手沖咖啡濾杯', priceTwd: 650 }, { title: '無線降噪耳機', priceTwd: 3990 }]) await w.cartAdd(item); };

    it('stores the script on the job, hands it to the runner in the claim, and reports it in promo_status', async () => {
      const w = world();
      await stock(w);
      const id = await w.queue({ script });
      expect((await w.status(id)).script).toEqual(script);
      const claimed = await w.claim();
      expect(claimed.job).toMatchObject({ id, status: 'storyboard', script });
      expect((await w.status(id)).script).toEqual(script);
    });

    it('gives a job without a script a null one, and tells scripts apart when deciding whether a queued job is the same', async () => {
      const w = world();
      await stock(w);
      const plain = await w.queue();
      expect((await w.status(plain)).script).toBeNull();
      const scripted = await w.queue({ script });
      expect(scripted).not.toBe(plain);
      expect(await w.queue({ script })).toBe(scripted);
      expect(await w.queue({ script: { ...script, ending: ['再見。'] } })).not.toBe(scripted);
    });

    it('refuses a script that does not fit the cart with messages Muse can act on, and queues nothing', async () => {
      const w = world();
      await stock(w);
      const wrongTitle = await w.call('promo_generate', { script: { items: [{ position: 1, title: '耳機', lines: ['好'] }] } });
      expect(wrongTitle.isError).toBe(true);
      expect(wrongTitle.content[0].text).toMatch(/腳本沒有收下.*position 1 寫的 title「耳機」，但貨架第 1 件是「手沖咖啡濾杯」/);
      const checkout = await w.call('promo_generate', { script: { ending: ['喜歡就立即購買'] } });
      expect(checkout.content[0].text).toMatch(/參數不正確.*ending\.0 .*沒有結帳流程/);
      const beyond = await w.call('promo_generate', { script: { items: [{ position: 3, lines: ['好'] }] } });
      expect(beyond.content[0].text).toMatch(/position 3 沒有場景/);
      expect((await w.next()).status).toBe(204);
    });

    it('refuses an amount when the owner hides prices, and allows it when they show them', async () => {
      const w = world();
      await stock(w);
      expect((await w.room('/api/share', { method: 'PUT', ...w.json({ enabled: false, prices: 'hidden', nickname: '小島' }) })).status).toBe(200);
      const priced = { opening: ['手沖濾杯只要 NT$650。'] };
      const refused = await w.call('promo_generate', { script: priced });
      expect(refused.isError).toBe(true);
      expect(refused.content[0].text).toMatch(/opening 提到價錢，但屋主把價格設成隱藏/);
      const viaRoom = await w.room('/api/promo', { method: 'POST', ...w.json({ script: priced }) });
      expect(viaRoom.status).toBe(400);
      expect(await viaRoom.json()).toMatchObject({ error: 'invalid_script', problems: [expect.stringContaining('opening 提到價錢')] });
      expect((await w.room('/api/share', { method: 'PUT', ...w.json({ enabled: false, prices: 'exact', nickname: '小島' }) })).status).toBe(200);
      expect((await w.call('promo_generate', { script: priced })).isError).toBe(false);
    });
  });

  it('refuses an empty cart and a body that is not a request', async () => {
    const { room, json } = world();
    const empty = await room('/api/promo', { method: 'POST', ...json({}) });
    expect(empty.status).toBe(409);
    expect(await empty.json()).toEqual({ error: 'empty_cart' });
    expect((await room('/api/promo', { method: 'POST', ...json({ durationSec: 60 }) })).status).toBe(400);
    expect((await room('/api/promo', { method: 'POST', body: '{nope', headers: { 'content-type': 'application/json' } })).status).toBe(400);
    expect((await room('/api/promo', { method: 'DELETE' })).status).toBe(405);
  });

  it('is the owner\'s: the key, or env.local\'s open access', async () => {
    const { send } = world();
    expect((await send('/api/promo')).status).toBe(401);
    expect((await send('/api/promo', { method: 'POST', body: '{}' })).status).toBe(401);
    const open = world({ OPEN_OWNER_ACCESS: 'true', CART_MCP_TOKEN: token });
    expect((await open.send('/api/promo')).status).toBe(200);
  });

  it('shows a job that has been picked up, then queues a fresh one after a failure', async () => {
    const { cartAdd, claim, room, json, report, progress } = world();
    await cartAdd({ title: 'pen' });
    const { jobId } = await (await room('/api/promo', { method: 'POST', ...json({}) })).json() as { jobId: string };
    await claim();
    await report(jobId, progress('voice', 0.4));
    expect(await (await room('/api/promo')).json()).toMatchObject({ id: jobId, status: 'voice', progress: 0.4 });
    await report(jobId, { status: 'failed', costUsd: 0, error: 'boom' });
    const retry = await (await room('/api/promo', { method: 'POST', ...json({}) })).json() as { jobId: string };
    expect(retry.jobId).not.toBe(jobId);
  });
});
