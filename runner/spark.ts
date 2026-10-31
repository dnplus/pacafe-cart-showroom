import fs from 'node:fs';
import { z } from 'zod';
import type { RunnerClaim } from '../shared/runner.ts';
import { PRICING } from '../tools/meta-hackathon/probe/common.ts';
import { issueSchema, ISSUE_KINDS, MAX_CPS, mockReview, sceneAt, type Issue } from './qa.ts';
import { scriptProblems, scriptScenes } from '../shared/script.ts';
import { fallbackStoryboard, PRICE_PATTERN, sceneFrames, SUBTITLE, withSubtitles, type Storyboard } from './storyboard.ts';

export const SPARK_MODEL = 'muse-spark-1.3';
/** Meta does not publish how many tokens an image costs; this guess only feeds the estimate when a reply has no usage. */
const IMAGE_TOKENS_GUESS = 1500;

export interface MetaConfig { baseUrl: string; apiKey: string; fetch: typeof fetch }
interface Spoken { content: string; costUsd: number }

const replySchema = z.object({ choices: z.array(z.object({ message: z.object({ content: z.string() }) })).min(1), usage: z.object({ prompt_tokens: z.number(), completion_tokens: z.number() }).optional() });
const sparkCost = (input: number, output: number) => input / 1e6 * PRICING.SPARK_INPUT_PER_M + output / 1e6 * PRICING.SPARK_OUTPUT_PER_M;

/** One JSON-mode chat completion. The estimate counts characters and images when the reply carries no usage. */
async function chat(config: MetaConfig, messages: unknown[], estimate: { inputTokens: number; outputTokens: number }): Promise<Spoken> {
  const response = await config.fetch(`${config.baseUrl}/chat/completions`, {
    method: 'POST', headers: { authorization: `Bearer ${config.apiKey}`, 'content-type': 'application/json' },
    body: JSON.stringify({ model: SPARK_MODEL, messages, response_format: { type: 'json_object' }, temperature: 0.2 }),
  });
  if (!response.ok) throw new Error(`Meta Model API answered ${response.status}: ${(await response.text()).slice(0, 200)}`);
  const reply = replySchema.parse(await response.json());
  const usage = reply.usage ?? { prompt_tokens: estimate.inputTokens, completion_tokens: estimate.outputTokens };
  return { content: reply.choices[0].message.content, costUsd: sparkCost(usage.prompt_tokens, usage.completion_tokens) };
}

const STORYBOARD_RULES = [
  '你是小屋購物車的短片字幕編劇。小屋把屋主的 Muse 採買時記下的東西擺上貨架；它沒有結帳，也不是購物網站。',
  '影片由屋主本人坐在小屋的直播棚主持，字幕就是屋主的口白：用第一人稱（我、我的小屋），Muse 是幫屋主採買的店員。',
  '依輸入的每個 scene 寫字幕，用輸入的 language 寫：zh-TW 是台灣繁體中文，en 是自然的英文。口吻溫暖、簡短。每句一行，每景 1 到 3 行。',
  `每行不超過 ${SUBTITLE.maxWidthEm} 個全形字寬（英文約 ${Math.floor(SUBTITLE.maxWidthEm / 0.6)} 個字母），每秒不超過 ${MAX_CPS} 個中文字（英文約 ${MAX_CPS * 2} 個字母）。`,
  '不得出現結帳、下單、購買、付款、立即購買這類字眼。只能用輸入裡的資訊；price 是 null 的地方不提價格，也不要猜。',
  '只回傳 JSON：{"scenes":[{"id":"<scene id>","subtitle":["..."]}]}，scene 的 id 和順序照輸入。',
].join('\n');
const sparkStoryboardSchema = z.object({ scenes: z.array(z.object({ id: z.string(), subtitle: z.array(z.string().trim().min(1).max(120)).min(1).max(3) })) });

export interface Storyboarded { storyboard: Storyboard; source: 'spark' | 'fallback' | 'muse'; costUsd: number }
export type Storyboarder = (claim: RunnerClaim) => Promise<Storyboarded>;

export const fallbackStoryboarder: Storyboarder = async ({ job, view }) => ({ storyboard: fallbackStoryboard(view, job), source: 'fallback', costUsd: 0 });

/** Spark writes the words; the screens, timing and prices come from the view, so Spark cannot show a price the owner hid. */
export const sparkStoryboarder = (config: MetaConfig, log: (line: string) => void): Storyboarder => async claim => {
  const { job, view } = claim, frames = sceneFrames(view, job);
  const input = { durationSec: job.durationSec, style: job.style, language: job.language, nickname: frames[0].kind === 'opening' ? frames[0].nickname : view.nickname, scenes: frames.map(({ subtitle: _, ...scene }) => scene) };
  const prompt = JSON.stringify(input);
  let costUsd = 0;
  try {
    const reply = await chat(config, [{ role: 'system', content: STORYBOARD_RULES }, { role: 'user', content: prompt }], { inputTokens: Math.ceil((STORYBOARD_RULES.length + prompt.length) * 1.5), outputTokens: 800 });
    costUsd = reply.costUsd;
    const written = new Map(sparkStoryboardSchema.parse(JSON.parse(reply.content)).scenes.map(scene => [scene.id, scene.subtitle]));
    const missing = frames.filter(scene => !written.has(scene.id));
    if (missing.length) throw new Error(`Spark left out ${missing.map(scene => scene.id).join(', ')}`);
    const storyboard = withSubtitles(view, frames, scene => written.get(scene.id)!, job.language);
    if (view.mode === 'hidden' && storyboard.scenes.some(scene => PRICE_PATTERN.test(scene.subtitle.join('')))) throw new Error('Spark wrote a price the owner hid');
    return { storyboard, source: 'spark', costUsd };
  } catch (error) {
    log(`Spark 分鏡失敗，改用本地分鏡：${error instanceof Error ? error.message : String(error)}`);
    return { storyboard: fallbackStoryboard(view, job), source: 'fallback', costUsd };
  }
};

/** `base` only runs (and only costs) when the script leaves a scene out; a script the view no longer allows, such as prices after the owner hid them, is dropped whole. */
export const museStoryboarder = (base: Storyboarder, log: (line: string) => void): Storyboarder => async claim => {
  const { job, view } = claim;
  if (!job.script) return base(claim);
  const problems = scriptProblems(job.script, view, job.durationSec);
  if (problems.length) {
    log(`Muse 的腳本不能用，改由 runner 寫口白：${problems.join('；')}`);
    return base(claim);
  }
  const frames = sceneFrames(view, job), given = scriptScenes(job.script);
  const rest = frames.every(scene => given.has(scene.id)) ? null : await base(claim);
  const storyboard = withSubtitles(view, frames, scene => given.get(scene.id) ?? rest!.storyboard.scenes.find(other => other.id === scene.id)!.subtitle, job.language);
  return { storyboard, source: 'muse', costUsd: rest?.costUsd ?? 0 };
};

export interface Frame { atSec: number; sceneId: string; file: string }
export interface Reviewed { mode: 'mock' | 'spark'; issues: Issue[]; costUsd: number }
export type Reviewer = (storyboard: Storyboard, frames: readonly Frame[]) => Promise<Reviewed>;

const REVIEW_RULES = [
  '你是短片的驗收員。輸入是分鏡 JSON 和幾張關鍵影格（每張註明秒數和 scene id）。',
  `檢查：字幕超出畫面左右安全邊界或被裁切（subtitle_overflow）；字幕在該景時長內讀不完，每秒超過 ${MAX_CPS} 字（pacing_too_fast）；畫面或字幕出現結帳、下單、購買按鈕、付款這類字樣（forbidden_wording），小屋沒有結帳。`,
  '片尾的英文聲明是必要的，不要回報它。沒有問題就回傳空陣列。',
  `只回傳 JSON：{"issues":[{"atSec":<秒>,"sceneId":"<scene id>","kind":"${ISSUE_KINDS.join('|')}","severity":"error|warning","message":"<一句話>"}]}`,
].join('\n');

/** Spark looks at the frames. An unknown scene id is placed by its time; a reply that does not parse is an error for the caller. */
export const sparkReviewer = (config: MetaConfig): Reviewer => async (storyboard, frames) => {
  const images = frames.flatMap(frame => [
    { type: 'text', text: `影格 ${frame.atSec.toFixed(1)} 秒，scene ${frame.sceneId}` },
    { type: 'image_url', image_url: { url: `data:image/jpeg;base64,${fs.readFileSync(frame.file).toString('base64')}` } },
  ]);
  const text = JSON.stringify(storyboard);
  const reply = await chat(config, [{ role: 'system', content: REVIEW_RULES }, { role: 'user', content: [{ type: 'text', text }, ...images] }],
    { inputTokens: Math.ceil((REVIEW_RULES.length + text.length) * 1.5) + frames.length * IMAGE_TOKENS_GUESS, outputTokens: 400 });
  const issues = z.object({ issues: z.array(issueSchema) }).parse(JSON.parse(reply.content)).issues;
  const ids = new Set(storyboard.scenes.map(scene => scene.id));
  return { mode: 'spark', costUsd: reply.costUsd, issues: issues.map(issue => ids.has(issue.sceneId) ? issue : { ...issue, sceneId: sceneAt(storyboard, issue.atSec).id }) };
};

export const mockReviewer: Reviewer = async storyboard => ({ mode: 'mock', issues: mockReview(storyboard), costUsd: 0 });

/** A Spark round that fails falls back to the mock rules for that round, and qa.json says which one ran. */
export const sparkOrMockReviewer = (spark: Reviewer, log: (line: string) => void): Reviewer => async (storyboard, frames) => {
  try { return await spark(storyboard, frames); } catch (error) {
    log(`Spark 看片失敗，這一輪改用 mock 規則：${error instanceof Error ? error.message : String(error)}`);
    return mockReviewer(storyboard, frames);
  }
};
