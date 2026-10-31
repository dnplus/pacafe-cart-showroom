import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { fixtureCartItems } from '../shared/fixtures/cart';
import type { Issue, QaReport } from '../runner/qa';
import { MAX_QA_ROUNDS, modelsFromEnv, redactor, runJob, type RunnerDeps } from '../runner/pipeline';
import type { Renderer } from '../runner/render';
import type { Reviewer } from '../runner/spark';
import { PRICE_PATTERN, SUBTITLE, textWidthEm, type PromoInput } from '../runner/storyboard';
import { selectTts } from '../runner/tts';
import { workerClient } from '../runner/worker-client';
import { claimFor, fakeRunnerWorker } from './fake-runner-worker';

const token = 'runner-test-token-0123456789';
const LONG_TITLE = '【現貨】日本製琺瑯細口手沖壺 1.2L 附溫度計 霧面白';
const longCart = [...fixtureCartItems.slice(0, 2), { title: LONG_TITLE, priceTwd: 2480, qty: 1 }];

/** Records what it was asked to draw and writes stand-in files, so tests run without Remotion or Chrome. */
function fakeRenderer(overrides: Partial<Renderer> = {}) {
  const videos: PromoInput[] = [], stills: { input: PromoInput; atSec: number }[] = [];
  const renderer: Renderer = {
    async video(input, output, onProgress) { videos.push(input); onProgress(0.5); onProgress(1); fs.writeFileSync(output, `mp4 ${JSON.stringify(input.storyboard)}`); return { durationSec: input.storyboard.durationSec }; },
    async still(input, atSec, output) { stills.push({ input, atSec }); fs.writeFileSync(output, 'jpg'); },
    async close() {},
    ...overrides,
  };
  return { renderer, videos, stills };
}

const workers: { close(): Promise<void> }[] = [], workDirs: string[] = [];
afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(workers.splice(0).map(worker => worker.close()));
  for (const dir of workDirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

const tempDir = () => { const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'runner-')); workDirs.push(dir); return dir; };

async function setup(claim = claimFor(fixtureCartItems, 'range'), { env = {}, http = fetch, renderer = fakeRenderer(), reviewer }: { env?: Record<string, string | undefined>; http?: typeof fetch; renderer?: ReturnType<typeof fakeRenderer>; reviewer?: Reviewer } = {}) {
  const worker = await fakeRunnerWorker(token, [claim]);
  workers.push(worker);
  const lines: string[] = [], redact = redactor({ ...env, CART_MCP_TOKEN: token }), log = (line: string) => lines.push(redact(line));
  const models = modelsFromEnv(env, http, log);
  const deps: RunnerDeps = { ...models, ...reviewer ? { reviewer } : {}, worker: workerClient(worker.origin, token, http), renderer: renderer.renderer, workDir: tempDir(), maxRounds: MAX_QA_ROUNDS, redact, log };
  const run = async () => runJob((await deps.worker.next())!, deps);
  const statuses = () => worker.updates.map(({ update }) => update.status).filter((status, i, all) => status !== all[i - 1]);
  const qa = () => JSON.parse(worker.uploads.get(`${claim.job.id}/qa.json`)!.toString()) as QaReport;
  const failure = () => worker.updates.map(({ update }) => update).find(update => update.status === 'failed');
  return { worker, deps, lines, run, statuses, qa, failure, claim, ...renderer };
}

describe('runner, mock models', () => {
  it('reports storyboard, voice, rendering, done to the worker and uploads the video, thumbnail and qa.json', async () => {
    const { worker, run, statuses, claim } = await setup();
    expect(await run()).toBe('done');
    expect(statuses()).toEqual(['storyboard', 'voice', 'rendering', 'done']);
    expect([...worker.uploads.keys()].sort()).toEqual(['qa.json', 'thumbnail.jpg', 'video.mp4'].map(name => `${claim.job.id}/${name}`));
    const done = worker.jobs.get(claim.job.id)!;
    expect(done.status).toBe('done');
    expect(done.output?.sha256).toBe(createHash('sha256').update(worker.uploads.get(`${claim.job.id}/video.mp4`)!).digest('hex'));
    expect(done.output?.durationSec).toBe(30);
    expect(done.costUsd).toBe(0);
    expect((await workerClient(worker.origin, token).next())).toBeNull();
  });

  it('with TTS none, or a provider whose key is missing, draws subtitles without a voice and calls no TTS', async () => {
    for (const env of [{}, { TTS_PROVIDER: 'elevenlabs' }, { TTS_PROVIDER: 'minimax', ELEVENLABS_API_KEY: 'el-key-not-for-minimax' }]) {
      const spy = vi.spyOn(globalThis, 'fetch');
      const { worker, run, videos, lines } = await setup(undefined, { env, http: globalThis.fetch });
      expect(await run()).toBe('done');
      expect(spy.mock.calls.map(([url]) => String(url)).filter(url => !url.startsWith(worker.origin))).toEqual([]);
      expect(spy).toHaveBeenCalled();
      expect(videos[0].voice).toEqual([]);
      expect(videos[0].storyboard.scenes.every(scene => scene.subtitle.length > 0)).toBe(true);
      if (env.TTS_PROVIDER) expect(lines.join('\n')).toMatch(/改用 none/);
      expect(lines.join('\n')).not.toContain('el-key-not-for-minimax');
      spy.mockRestore();
    }
  });

  it('with a voice provider and its keys, speaks each scene and hands the clips to the render', async () => {
    const calls: { url: string; headers: Headers }[] = [];
    const http = (async (url: string | URL | Request, init?: RequestInit) => {
      if (String(url).startsWith('https://api.elevenlabs.io/')) { calls.push({ url: String(url), headers: new Headers(init?.headers) }); return new Response(fs.readFileSync(path.join(import.meta.dirname, 'fixtures/silence-1s.mp3'))); }
      return fetch(url, init);
    }) as typeof fetch;
    const { run, videos } = await setup(undefined, { env: { TTS_PROVIDER: 'elevenlabs', ELEVENLABS_API_KEY: 'el-test-key', ELEVENLABS_VOICE_ID: 'voice-1' }, http });
    expect(await run()).toBe('done');
    expect(calls.length).toBeGreaterThan(0);
    expect(calls.every(call => call.url.includes('/v1/text-to-speech/voice-1') && call.headers.get('xi-api-key') === 'el-test-key')).toBe(true);
    expect(videos[0].voice.map(clip => clip.sceneId)).toEqual(videos[0].storyboard.scenes.map(scene => scene.id));
    expect(videos[0].voice.every(clip => clip.src.startsWith('data:audio/mpeg;base64,') && Math.abs(clip.durationSec - 1) < 0.1)).toBe(true);
  });

  it('wraps an overflowing subtitle in round one and passes in round two', async () => {
    const { run, qa, videos } = await setup(claimFor(longCart, 'exact'));
    expect(await run()).toBe('done');
    const report = qa();
    expect(report.rounds.map(round => round.mode)).toEqual(['mock', 'mock']);
    expect(report.rounds[0].issues).toEqual([expect.objectContaining({ kind: 'subtitle_overflow', sceneId: 'item-3', severity: 'error' })]);
    expect(report.rounds[1].issues).toEqual([]);
    expect(report.passed).toBe(true);
    const fixed = videos[0].storyboard.scenes.find(scene => scene.id === 'item-3')!;
    expect(fixed.subtitle.length).toBeGreaterThan(1);
    expect(fixed.subtitle.every(line => textWidthEm(line) <= SUBTITLE.maxWidthEm)).toBe(true);
    expect(fixed.subtitle.join('')).toContain(LONG_TITLE.replace(/\s/g, '').slice(0, 10));
    const issueAt = Math.round(report.rounds[0].issues[0].atSec * 10) / 10;
    expect(report.rounds[1].frames.map(frame => frame.atSec)).toContain(issueAt);
  });

  it('fails the job when errors are left after the last round, and still uploads qa.json', async () => {
    const stuck: Issue = { atSec: 1, sceneId: 'opening', kind: 'forbidden_wording', severity: 'error', message: '畫面上有結帳按鈕。' };
    const { worker, run, qa, failure, claim } = await setup(undefined, { reviewer: async () => ({ mode: 'mock', issues: [stuck], costUsd: 0 }) });
    expect(await run()).toBe('failed');
    expect(qa().rounds).toHaveLength(MAX_QA_ROUNDS);
    expect(qa().passed).toBe(false);
    expect(failure()?.status === 'failed' && failure()!.error).toMatch(/forbidden_wording@opening/);
    expect(worker.uploads.has(`${claim.job.id}/video.mp4`)).toBe(false);
  });

  it('ships a video whose last round has only warnings, listing them in qa.json', async () => {
    const slow: Issue = { atSec: 1, sceneId: 'opening', kind: 'pacing_too_fast', severity: 'warning', message: '字幕太快。' };
    const { run, qa } = await setup(undefined, { reviewer: async () => ({ mode: 'mock', issues: [slow], costUsd: 0 }) });
    expect(await run()).toBe('done');
    expect(qa().passed).toBe(true);
    expect(qa().rounds.at(-1)!.issues).toEqual([slow]);
  });

  it('puts no price anywhere in the storyboard or the render input when prices are hidden', async () => {
    const { run, videos, stills } = await setup(claimFor(fixtureCartItems, 'hidden'));
    expect(await run()).toBe('done');
    for (const input of [videos[0], ...stills.map(still => still.input)]) {
      const text = JSON.stringify(input);
      expect(text).not.toMatch(PRICE_PATTERN);
      for (const amount of ['650', '3,990', '3990', '7,460', '7460']) expect(text).not.toContain(amount);
      expect(input.storyboard.scenes.flatMap(scene => scene.kind === 'item' ? [scene.price] : scene.kind === 'opening' ? [scene.total] : [])).toEqual([null, null, null, null, null, null]);
    }
  });
});

describe('Spark, through a stand-in Meta Model API', () => {
  const FAKE_KEY = 'meta-FAKE-key-LEAKCHECK-4242';
  const env = { META_API_KEY: FAKE_KEY, META_API_BASE_URL: 'https://meta.test/v1' };
  const reply = (content: unknown) => Response.json({ choices: [{ message: { content: JSON.stringify(content) } }], usage: { prompt_tokens: 2000, completion_tokens: 400 } });
  const meta = (answer: (body: { messages: { content: unknown }[] }) => Response) => {
    const seen: { url: string; auth: string | null; body: { model: string; messages: { content: unknown }[] } }[] = [];
    const http = (async (url: string | URL | Request, init?: RequestInit) => {
      if (!String(url).startsWith('https://meta.test/')) return fetch(url, init);
      const body = JSON.parse(String(init!.body));
      seen.push({ url: String(url), auth: new Headers(init!.headers).get('authorization'), body });
      return answer(body);
    }) as typeof fetch;
    return { http, seen };
  };
  const isReview = (body: { messages: { content: unknown }[] }) => Array.isArray(body.messages[1].content);

  it('writes the subtitles with Spark, reviews the frames with Spark, and counts what both cost', async () => {
    const claim = claimFor(fixtureCartItems.slice(0, 2), 'exact');
    const { http, seen } = meta(body => isReview(body) ? reply({ issues: [] }) : reply({ scenes: ['opening', 'item-1', 'item-2', 'ending'].map(id => ({ id, subtitle: [`${id} 的字幕。`] })) }));
    const { run, videos, qa, worker } = await setup(claim, { env, http });
    expect(await run()).toBe('done');
    expect(seen.every(call => call.url === 'https://meta.test/v1/chat/completions' && call.auth === `Bearer ${FAKE_KEY}` && call.body.model === 'muse-spark-1.3')).toBe(true);
    expect(videos[0].storyboard.scenes.map(scene => scene.subtitle[0])).toEqual(['opening 的字幕。', 'item-1 的字幕。', 'item-2 的字幕。', 'ending 的字幕。']);
    expect(qa()).toMatchObject({ storyboard: 'spark', rounds: [{ mode: 'spark', issues: [] }] });
    const images = seen.filter(call => isReview(call.body)).flatMap(call => call.body.messages[1].content as { type: string; image_url?: { url: string } }[]).filter(part => part.type === 'image_url');
    expect(images.length).toBe(4);
    expect(images.every(part => part.image_url!.url.startsWith('data:image/jpeg;base64,'))).toBe(true);
    expect(worker.jobs.get(claim.job.id)!.costUsd).toBeCloseTo(2 * (2000 / 1e6 * 1.25 + 400 / 1e6 * 4.25));
  });

  it('falls back to the local storyboard when Spark writes a price the owner hid', async () => {
    const { http } = meta(body => isReview(body) ? reply({ issues: [] }) : reply({ scenes: ['opening', 'item-1', 'item-2', 'ending'].map(id => ({ id, subtitle: ['只要 NT$ 650！'] })) }));
    const { run, videos, qa, lines } = await setup(claimFor(fixtureCartItems.slice(0, 2), 'hidden'), { env, http });
    expect(await run()).toBe('done');
    expect(qa().storyboard).toBe('fallback');
    expect(JSON.stringify(videos[0])).not.toMatch(PRICE_PATTERN);
    expect(lines.join('\n')).toMatch(/改用本地分鏡/);
  });

  it('reports failed with no key in the message or the log, whichever step breaks', async () => {
    const leaky = () => { throw new Error(`upstream said: invalid Authorization: Bearer ${FAKE_KEY}`); };
    const { http } = meta(() => new Response(`{"error":"bad key ${FAKE_KEY}"}`, { status: 401 }));
    for (const breaks of ['storyboarder', 'tts', 'still', 'video'] as const) {
      const renderer = fakeRenderer(breaks === 'still' ? { still: async () => leaky() } : breaks === 'video' ? { video: async () => leaky() } : {});
      const { deps, run, failure, lines, statuses } = await setup(undefined, { env, http, renderer });
      if (breaks === 'storyboarder') deps.storyboarder = async () => leaky();
      if (breaks === 'tts') deps.tts = { name: 'elevenlabs', voice: async () => leaky() };
      expect(await run()).toBe('failed');
      expect(statuses().at(-1)).toBe('failed');
      const sent = failure()!;
      expect(sent.status === 'failed' && sent.error).toContain('[REDACTED]');
      expect(JSON.stringify(sent)).not.toContain(FAKE_KEY);
      expect(lines.join('\n')).not.toContain(FAKE_KEY);
    }
  });
});

describe('selectTts', () => {
  it('reads the provider from TTS_PROVIDER, defaults to none, and refuses a name it does not know', () => {
    const log = vi.fn();
    expect(selectTts({}, fetch, log).name).toBe('none');
    expect(selectTts({ TTS_PROVIDER: 'minimax', MINIMAX_API_KEY: 'mm-key' }, fetch, log).name).toBe('minimax');
    expect(() => selectTts({ TTS_PROVIDER: 'espeak' }, fetch, log)).toThrow();
  });
});
