import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import type { RunnerClaim, RunnerUpdate } from '../shared/runner.ts';
import { applyFixes, fitVoice, keyframes, type Issue, type QaReport, type QaRound } from './qa.ts';
import type { Renderer } from './render.ts';
import { fallbackStoryboarder, mockReviewer, museStoryboarder, sparkOrMockReviewer, sparkReviewer, sparkStoryboarder, type Reviewer, type Storyboarder } from './spark.ts';
import type { Storyboard } from './storyboard.ts';
import type { VoiceConfig } from '../shared/voice.ts';
import { selectTts, ttsFor, type Tts } from './tts.ts';
import type { RunnerWorker } from './worker-client.ts';

export const MAX_QA_ROUNDS = 3;
type Env = Readonly<Record<string, string | undefined>>;

export interface RunnerDeps {
  worker: RunnerWorker;
  storyboarder: Storyboarder;
  /** The voice from the runner's own environment, for a claim that carries none. */
  tts: Tts;
  /** The voice for a claim that carries the owner's room settings; defaults to speaking over fetch. */
  voiceFor?: (config: VoiceConfig) => Tts;
  reviewer: Reviewer;
  renderer: Renderer;
  /** Each job works in `<workDir>/<jobId>`, emptied when the job starts so a re-claimed job starts clean. */
  workDir: string;
  maxRounds: number;
  /** Takes every secret out of a message before it is logged or sent to the worker. */
  redact: (text: string) => string;
  log: (line: string) => void;
}

/** Muse's own script first when the job has one; otherwise Spark for the storyboard and the review when both Meta variables are set, the local fallback and mock rules otherwise. */
export function modelsFromEnv(env: Env, http: typeof fetch, log: (line: string) => void): Pick<RunnerDeps, 'storyboarder' | 'reviewer' | 'tts'> {
  const missing = ['META_API_KEY', 'META_API_BASE_URL'].filter(name => !env[name]);
  const meta = missing.length ? null : { baseUrl: env.META_API_BASE_URL!.replace(/\/+$/, ''), apiKey: env.META_API_KEY!, fetch: http };
  log(meta ? `分鏡和看片用 Spark（${meta.baseUrl}）。` : `沒有設定 ${missing.join('、')}：分鏡用本地 fallback，看片用 mock 規則，不花錢。`);
  return {
    storyboarder: museStoryboarder(meta ? sparkStoryboarder(meta, log) : fallbackStoryboarder, log),
    reviewer: meta ? sparkOrMockReviewer(sparkReviewer(meta), log) : mockReviewer,
    tts: selectTts(env, http, log),
  };
}

const SECRETS = ['META_API_KEY', 'ELEVENLABS_API_KEY', 'MINIMAX_API_KEY', 'CART_MCP_TOKEN'];
export function redactor(env: Env) {
  const values = SECRETS.map(name => env[name]).filter((value): value is string => !!value && value.length >= 4);
  return (text: string) => values.reduce((out, value) => out.replaceAll(value, '[REDACTED]'), text);
}

const errorsIn = (issues: readonly Issue[]) => issues.filter(issue => issue.severity === 'error');
const describe = (issues: readonly Issue[]) => issues.map(issue => `${issue.kind}@${issue.sceneId}`).join('、');

/**
 * Each round draws keyframes of the current storyboard, has them reviewed, and fixes what was found; the next round looks
 * at the fixed storyboard. The loop ends on a round with no issues or after `maxRounds`, and the storyboard it returns is
 * always the one the last round reviewed, never an unreviewed fix.
 */
async function review(drafted: Storyboard, dir: string, deps: RunnerDeps, progress: (round: number) => Promise<unknown>) {
  const rounds: QaRound[] = [];
  let storyboard = drafted, previous: Issue[] = [], costUsd = 0;
  for (let round = 1; round <= deps.maxRounds; round++) {
    const roundDir = path.join(dir, `round-${round}`);
    fs.mkdirSync(roundDir, { recursive: true });
    const frames = [];
    for (const point of keyframes(storyboard, previous)) {
      const file = path.join(roundDir, `${point.atSec.toFixed(1).padStart(4, '0')}s-${point.sceneId}.jpg`);
      await deps.renderer.still({ storyboard, voice: [] }, point.atSec, file);
      frames.push({ ...point, file });
    }
    const reviewed = await deps.reviewer(storyboard, frames);
    costUsd += reviewed.costUsd;
    rounds.push({ round, mode: reviewed.mode, frames: frames.map(({ atSec, sceneId }) => ({ atSec, sceneId })), issues: reviewed.issues });
    deps.log(`QA 第 ${round} 輪（${reviewed.mode}）：${reviewed.issues.length ? describe(reviewed.issues) : '沒有問題'}`);
    await progress(round);
    if (!reviewed.issues.length || round === deps.maxRounds) break;
    previous = reviewed.issues;
    storyboard = applyFixes(storyboard, reviewed.issues);
  }
  return { storyboard, rounds, costUsd, remaining: rounds.at(-1)!.issues };
}

const sha256 = (file: string) => createHash('sha256').update(fs.readFileSync(file)).digest('hex');

/**
 * One job from claim to done or failed. Errors left after the last QA round fail the job: done has no field for warnings,
 * and a video with clipped subtitles or checkout wording would misdescribe the showroom. Warnings alone still ship, and
 * qa.json, uploaded either way, lists them.
 */
export async function runJob(claim: RunnerClaim, deps: RunnerDeps): Promise<'done' | 'failed'> {
  const { job } = claim, dir = path.join(deps.workDir, job.id);
  // The room's voice key arrives with the claim, so it is taken out of every message as the environment's keys are.
  const redact = claim.voice ? (text: string) => deps.redact(text).replaceAll(claim.voice!.apiKey, '[REDACTED]') : deps.redact;
  const tts = claim.voice ? (deps.voiceFor ?? (config => ttsFor(config, fetch)))(claim.voice) : deps.tts;
  let costUsd = 0;
  const report = (update: Exclude<RunnerUpdate, { status: 'done' | 'failed' }>['status'], progress: number) => deps.worker.update(job.id, { status: update, progress, costUsd });
  try {
    fs.rmSync(dir, { recursive: true, force: true });
    fs.mkdirSync(dir, { recursive: true });
    const drafted = await deps.storyboarder(claim);
    costUsd += drafted.costUsd;
    deps.log(`${job.id}：分鏡 ${drafted.source}，${drafted.storyboard.scenes.length} 景，${job.durationSec} 秒`);
    await report('storyboard', 1);

    await report('voice', 0);
    if (claim.voice) deps.log(`${job.id}：配音用房間設定的 ${tts.name}`);
    await tts.voice(drafted.storyboard);
    await report('voice', 1);

    await report('rendering', 0);
    const qa = await review(drafted.storyboard, dir, deps, round => report('rendering', 0.5 * round / deps.maxRounds));
    costUsd += qa.costUsd;
    const errors = errorsIn(qa.remaining);
    const qaReport: QaReport = { version: 1, storyboard: drafted.source, maxRounds: deps.maxRounds, passed: !errors.length, rounds: qa.rounds };
    const qaFile = path.join(dir, 'qa.json');
    fs.writeFileSync(qaFile, JSON.stringify(qaReport, null, 2));
    await deps.worker.upload(job.id, 'qa.json', fs.readFileSync(qaFile));
    if (errors.length) throw new Error(`QA ${qa.rounds.length} 輪後仍有 ${errors.length} 個 error：${describe(errors)}`);

    // A wording fix changes what is said, so the final storyboard is voiced again; unchanged scenes come from the cache.
    const voice = await tts.voice(qa.storyboard);
    const input = { storyboard: fitVoice(qa.storyboard, voice), voice };
    const cut = voice.filter(clip => { const scene = input.storyboard.scenes.find(s => s.id === clip.sceneId)!; return clip.durationSec > scene.endSec - scene.startSec; });
    if (cut.length) deps.log(`${job.id}：配音比片長多，${cut.map(clip => clip.sceneId).join('、')} 的尾巴會被切掉`);
    const videoFile = path.join(dir, 'video.mp4'), thumbnailFile = path.join(dir, 'thumbnail.jpg');
    // Progress reports go out one at a time and in order; the first one the worker refuses fails the job after the render.
    let reported = 0, reports = Promise.resolve(), refused: unknown;
    const { durationSec } = await deps.renderer.video(input, videoFile, progress => {
      if (progress - reported < 0.1) return;
      reported = progress;
      reports = reports.then(() => report('rendering', 0.5 + 0.45 * progress)).then(() => {}, error => { refused ??= error; });
    });
    await reports;
    if (refused) throw refused;
    const opening = input.storyboard.scenes[0];
    await deps.renderer.still(input, (opening.startSec + opening.endSec) / 2, thumbnailFile);
    await deps.worker.upload(job.id, 'video.mp4', fs.readFileSync(videoFile));
    await deps.worker.upload(job.id, 'thumbnail.jpg', fs.readFileSync(thumbnailFile));
    await deps.worker.update(job.id, { status: 'done', costUsd, video: { sha256: sha256(videoFile), durationSec } });
    deps.log(`${job.id}：done，${durationSec} 秒，估計花費 $${costUsd.toFixed(4)}`);
    return 'done';
  } catch (error) {
    const message = redact(error instanceof Error ? error.message : String(error)).trim().slice(0, 500) || 'runner failed';
    deps.log(`${job.id}：failed：${message}`);
    try { await deps.worker.update(job.id, { status: 'failed', costUsd, error: message }); } catch (reportError) {
      deps.log(`${job.id}：回報 failed 也失敗：${redact(reportError instanceof Error ? reportError.message : String(reportError))}`);
    }
    return 'failed';
  }
}
