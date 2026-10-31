import { z } from 'zod';
import { FORBIDDEN_WORDING } from '../shared/script.ts';
import { charCount, retime, SUBTITLE, textWidthEm, type Scene, type Storyboard, type VoiceClip } from './storyboard.ts';

/** In the order fixes apply: wording changes the text, overflow then re-wraps it, pacing last re-times the result. */
export const ISSUE_KINDS = ['forbidden_wording', 'subtitle_overflow', 'pacing_too_fast'] as const;
type IssueKind = typeof ISSUE_KINDS[number];

export const issueSchema = z.strictObject({
  atSec: z.number().nonnegative(),
  sceneId: z.string().min(1),
  kind: z.enum(ISSUE_KINDS),
  severity: z.enum(['error', 'warning']),
  message: z.string().trim().min(1).max(300),
});
export type Issue = z.infer<typeof issueSchema>;

export interface QaRound { round: number; mode: 'mock' | 'spark'; frames: { atSec: number; sceneId: string }[]; issues: Issue[] }
/** qa.json: what each round looked at and found, uploaded with the video so the owner can see why it looks the way it does. */
export interface QaReport { version: 1; storyboard: 'spark' | 'fallback' | 'muse'; maxRounds: number; passed: boolean; rounds: QaRound[] }

/** A subtitle faster than this is hard to read; the pacing fix aims for TARGET_CPS so a stretched scene clears it with room. */
export const MAX_CPS = 9;
const TARGET_CPS = 7;
const MIN_SCENE_SEC = 1.5;

export { FORBIDDEN_WORDING };

const midpoint = (scene: Scene) => (scene.startSec + scene.endSec) / 2;
const duration = (scene: Scene) => scene.endSec - scene.startSec;
/** The time a scene needs to read comfortably, and the least it can have and still pass the pacing check (a frame or so of margin). */
const needSec = (scene: Scene) => Math.max(MIN_SCENE_SEC, charCount(scene.subtitle) / TARGET_CPS);
const passSec = (scene: Scene) => Math.max(MIN_SCENE_SEC, charCount(scene.subtitle) / MAX_CPS) + 0.05;

/**
 * The mock reviewer: rules over the storyboard and the subtitle metrics the composition draws with. It does not look at
 * the frames; the Spark reviewer does. Deterministic, so a storyboard that passes once always passes.
 */
export function mockReview(storyboard: Storyboard): Issue[] {
  return storyboard.scenes.flatMap((scene): Issue[] => {
    const at = midpoint(scene);
    const wide = scene.subtitle.filter(line => textWidthEm(line) > SUBTITLE.maxWidthEm);
    const said = scene.subtitle.join('');
    const words = FORBIDDEN_WORDING.flatMap(([pattern]) => said.match(pattern) ?? []);
    const cps = charCount(scene.subtitle) / duration(scene);
    return [
      ...words.length ? [{ atSec: at, sceneId: scene.id, kind: 'forbidden_wording', severity: 'error', message: `字幕出現「${[...new Set(words)].join('、')}」，小屋沒有結帳流程。` } as const] : [],
      ...wide.map(line => ({ atSec: at, sceneId: scene.id, kind: 'subtitle_overflow', severity: 'error', message: `字幕寬 ${textWidthEm(line).toFixed(1)} 字，超過安全寬度 ${SUBTITLE.maxWidthEm} 字：${line.slice(0, 40)}` } as const)),
      ...cps > MAX_CPS || duration(scene) < MIN_SCENE_SEC ? [{ atSec: at, sceneId: scene.id, kind: 'pacing_too_fast', severity: 'warning', message: `${duration(scene).toFixed(1)} 秒要讀 ${charCount(scene.subtitle)} 字（每秒 ${cps.toFixed(1)} 字）。` } as const] : [],
    ];
  });
}

/** Split after the last punctuation that keeps a line at least half full, else at the width; Latin words stay whole. */
function wrapLine(text: string, maxEm = SUBTITLE.maxWidthEm): string[] {
  const tokens = text.match(/[A-Za-z0-9$,.'’\-–]+|\s+|./gu) ?? [];
  const lines: string[] = [];
  let current = '';
  for (const token of tokens) {
    if (textWidthEm(current + token) <= maxEm || !current.trim()) { current += token; continue; }
    const cut = Math.max(...[...'，。、！？；：」）'].map(mark => current.lastIndexOf(mark)));
    const keep = cut >= 0 && textWidthEm(current.slice(0, cut + 1)) >= maxEm / 2 ? cut + 1 : current.length;
    lines.push(current.slice(0, keep).trim());
    current = current.slice(keep) + token;
  }
  if (current.trim()) lines.push(current.trim());
  return lines.flatMap(line => textWidthEm(line) <= maxEm ? [line] : hardWrap(line, maxEm));
}
function hardWrap(line: string, maxEm: number) {
  const out = [''];
  for (const char of line) { if (textWidthEm(out.at(-1)! + char) > maxEm) out.push(''); out[out.length - 1] += char; }
  return out;
}

const flagged = (issues: readonly Pick<Issue, 'sceneId'>[]) => new Set(issues.map(issue => issue.sceneId));
const onScenes = (storyboard: Storyboard, issues: readonly Issue[], fix: (scene: Scene) => Scene): Storyboard => {
  const ids = flagged(issues);
  return { ...storyboard, scenes: storyboard.scenes.map(scene => ids.has(scene.id) ? fix(scene) : scene) };
};

/**
 * Flagged scenes get the time they need to read at TARGET_CPS. The others before the ending give up their spare time in
 * proportion, never going under what they need to pass themselves, so a fix never makes a scene that passed fail. When there is
 * not enough spare time the flagged scenes share what there is. The ending keeps its length since it carries the disclaimer.
 * With `voiceSec`, no scene gets less than its voice clip and a short tail.
 */
function stretch(storyboard: Storyboard, issues: readonly Pick<Issue, 'sceneId'>[], voiceSec: ReadonlyMap<string, number> = new Map()): Storyboard {
  const ids = flagged(issues), { scenes, durationSec } = storyboard;
  const roles = scenes.map(scene => ids.has(scene.id) ? 'grow' : scene.kind === 'ending' ? 'keep' : 'squeeze');
  const total = (role: string, sec: (scene: Scene) => number) => scenes.reduce((sum, scene, i) => roles[i] === role ? sum + sec(scene) : sum, 0);
  const spokenSec = (scene: Scene) => voiceSec.has(scene.id) ? voiceSec.get(scene.id)! + VOICE_TAIL_SEC : 0;
  const wantSec = (scene: Scene) => Math.max(duration(scene), needSec(scene), spokenSec(scene));
  const floorSec = (scene: Scene) => Math.max(Math.min(duration(scene), passSec(scene)), spokenSec(scene));
  const squeezed = roles.filter(role => role === 'squeeze').length, kept = total('keep', duration), floor = total('squeeze', floorSec);
  const room = durationSec - kept - floor, wanted = total('grow', wantSec);
  // With nothing left to squeeze the flagged scenes take all the room, so the scenes still tile the whole video.
  const growBy = squeezed && wanted <= room ? 1 : room / wanted;
  const spare = room - wanted * growBy, slack = total('squeeze', duration) - floor;
  const durations = scenes.map((scene, i) => roles[i] === 'grow' ? wantSec(scene) * growBy : roles[i] === 'keep' ? duration(scene)
    : floorSec(scene) + spare * (slack > 0 ? (duration(scene) - floorSec(scene)) / slack : 1 / squeezed));
  return { ...storyboard, scenes: retime(scenes, durations, durationSec) };
}

export const VOICE_TAIL_SEC = 0.3;

export function fitVoice(storyboard: Storyboard, clips: readonly VoiceClip[]): Storyboard {
  const voiceSec = new Map(clips.map(clip => [clip.sceneId, clip.durationSec]));
  const over = storyboard.scenes.filter(scene => (voiceSec.get(scene.id) ?? 0) + VOICE_TAIL_SEC > duration(scene));
  return over.length ? stretch(storyboard, over.map(scene => ({ sceneId: scene.id })), voiceSec) : storyboard;
}

/** One repair per kind: each takes the storyboard and the issues of its kind and returns a storyboard without them. */
export const FIXES: Readonly<Record<IssueKind, (storyboard: Storyboard, issues: readonly Issue[]) => Storyboard>> = {
  forbidden_wording: (storyboard, issues) => onScenes(storyboard, issues, scene => ({ ...scene, subtitle: scene.subtitle.map(line => FORBIDDEN_WORDING.reduce((text, [pattern, word]) => text.replace(pattern, word), line)) })),
  subtitle_overflow: (storyboard, issues) => onScenes(storyboard, issues, scene => ({ ...scene, subtitle: scene.subtitle.flatMap(line => wrapLine(line)) })),
  pacing_too_fast: stretch,
};

export const applyFixes = (storyboard: Storyboard, issues: readonly Issue[]): Storyboard =>
  ISSUE_KINDS.reduce((board, kind) => {
    const of = issues.filter(issue => issue.kind === kind);
    return of.length ? FIXES[kind](board, of) : board;
  }, storyboard);

/** Keyframes for a round: the middle of every scene, plus the moment of each issue the last round found. */
export function keyframes(storyboard: Storyboard, previous: readonly Issue[]): { atSec: number; sceneId: string }[] {
  const at = new Map<string, { atSec: number; sceneId: string }>();
  for (const point of [...storyboard.scenes.map(scene => ({ atSec: midpoint(scene), sceneId: scene.id })), ...previous]) {
    const atSec = Math.min(Math.round(point.atSec * 10) / 10, storyboard.durationSec - 0.05);
    at.set(atSec.toFixed(1), { atSec, sceneId: sceneAt(storyboard, atSec).id });
  }
  return [...at.values()].sort((a, b) => a.atSec - b.atSec);
}

export const sceneAt = (storyboard: Storyboard, atSec: number) => storyboard.scenes.find(scene => atSec < scene.endSec) ?? storyboard.scenes.at(-1)!;
