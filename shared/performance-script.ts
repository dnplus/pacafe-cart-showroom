import { z } from 'zod';

/** The barista's acts are the five rows of the service sheet; there is no talking row, so a line is shown as a caption. */
const PERFORMANCE_ACTS = ['idle', 'greet', 'brew', 'serve', 'wipe'] as const;
export type PerformanceAct = typeof PERFORMANCE_ACTS[number];
const PERFORMANCE_MAX_SECONDS = 90;

const cameraSchema = z.strictObject({ zoom: z.number().min(1).max(3), focus: z.enum(['host', 'spot']) });
const cueSchema = z.strictObject({
  at: z.number().min(0).max(PERFORMANCE_MAX_SECONDS),
  until: z.number().positive().max(PERFORMANCE_MAX_SECONDS),
  act: z.enum(PERFORMANCE_ACTS),
  line: z.string().trim().min(1).max(200).optional(),
  camera: cameraSchema.optional(),
});
const scriptSchema = z.strictObject({
  version: z.literal(1),
  format: z.strictObject({ width: z.literal(1080), height: z.literal(1920), fps: z.literal(30) }),
  spot: z.string().min(1).max(180),
  cues: z.array(cueSchema).min(1).max(120),
});
type PerformanceCue = z.infer<typeof cueSchema>;
export type PerformanceScript = z.infer<typeof scriptSchema>;
type PerformanceCamera = z.infer<typeof cameraSchema>;
interface PerformanceIssue { path: string; message: string }

/**
 * Checks a script a resident uploads. `placed` answers whether a furniture id is placed and out in the same room as the studio.
 * Every problem comes back with its path (`cues.2.until`) so the resident can fix the script without guessing.
 */
export function parsePerformanceScript(raw: unknown, placed: (furnitureId: string) => boolean): { ok: true; script: PerformanceScript } | { ok: false; issues: PerformanceIssue[] } {
  const parsed = scriptSchema.safeParse(raw);
  if (!parsed.success) return { ok: false, issues: parsed.error.issues.map(issue => ({ path: issue.path.join('.') || '(script)', message: issue.message })) };
  const script = parsed.data, issues: PerformanceIssue[] = [];
  if (!placed(script.spot)) issues.push({ path: 'spot', message: 'Use the id of a piece placed in this room, such as the laptop or its desk.' });
  script.cues.forEach((cue, index) => { if (cue.until <= cue.at) issues.push({ path: `cues.${index}.until`, message: `until (${cue.until}) must be after at (${cue.at}).` }); });
  const order = script.cues.map((cue, index) => ({ cue, index })).sort((a, b) => a.cue.at - b.cue.at);
  for (let i = 1; i < order.length; i++) {
    const before = order[i - 1], after = order[i];
    if (after.cue.at < before.cue.until) issues.push({ path: `cues.${after.index}.at`, message: `cues.${after.index} starts at ${after.cue.at}s, before cues.${before.index} ends at ${before.cue.until}s. Cues must not overlap.` });
  }
  return issues.length ? { ok: false, issues } : { ok: true, script: { ...script, cues: order.map(entry => entry.cue) } };
}

export const performanceLength = (script: PerformanceScript) => Math.max(...script.cues.map(cue => cue.until));

interface PerformanceFrame { act: PerformanceAct; elapsed: number; line: string | null; camera: PerformanceCamera; spot: string; cue: number | null; done: boolean }
const restingCamera: PerformanceCamera = { zoom: 1, focus: 'host' };
/**
 * What the barista does at `t` seconds: the act, seconds into that act, the caption, the camera and the spot.
 * A cue covers [at, until); between cues the barista idles. The room and the A-roll capture both read the show only through here.
 */
export function performanceAt(script: PerformanceScript, t: number): PerformanceFrame {
  const index = script.cues.findIndex(cue => t >= cue.at && t < cue.until), cue: PerformanceCue | null = index >= 0 ? script.cues[index] : null;
  const previous = cue ? null : script.cues.filter(entry => entry.until <= t).at(-1);
  return {
    act: cue?.act ?? 'idle', elapsed: Math.max(0, t - (cue?.at ?? previous?.until ?? 0)), line: cue?.line ?? null,
    camera: cue?.camera ?? restingCamera, spot: script.spot, cue: cue ? index : null, done: t >= performanceLength(script),
  };
}
