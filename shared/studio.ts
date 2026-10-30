import { z } from 'zod';
import type { BaristaAppearance, BaristaLookKind, Character } from './domain.ts';
import type { FloorId } from './floors.ts';
import { locales } from './locales.ts';
import type { PerformanceScript } from './performance-script.ts';
import type { RoomFinishChoice } from './room-finishes.ts';
import type { RoomFurnitureItem } from './room-settings.ts';

/** The self-media room: the cafe keeps the project state; the owner's own bot records, edits and renders on the owner's machine. */
export const STUDIO_STAGES = ['interview', 'script', 'aroll', 'broll', 'edit', 'render', 'review'] as const;
export type StudioStage = typeof STUDIO_STAGES[number];

export type StageState =
  | { status: 'todo' }
  | { status: 'running'; since: number; by: string }
  | { status: 'done'; at: number; by: string; note?: string }
  | { status: 'failed'; at: number; by: string; error: string };

export const STUDIO_SET_PRESETS = ['presenter', 'gaming', 'teaching'] as const;
export type StudioSetPreset = typeof STUDIO_SET_PRESETS[number];
/** A studio set standing on the laptop's floor: the preset and where its origin is. Covered furniture stays where it was. */
export interface StudioSet { preset: StudioSetPreset; x: number; z: number }
/** The spot id of a set's C position; a script's spot is replaced by it (or by the chair the barista picked) while a set is up. */
export const STUDIO_SET_SPOT = 'studio-set';

/**
 * The set the interview chose (`set: presenter|gaming|teaching` in style, presenter when unsaid). Without a seated sheet the
 * barista cannot sit at a desk, so they host from the teaching set's lectern instead.
 */
export function studioSetChoice(style: string, seated: boolean): StudioSetPreset {
  const said = /^set:\s*(\w+)/im.exec(style)?.[1]?.toLowerCase();
  const preset = STUDIO_SET_PRESETS.find(name => name === said) ?? 'presenter';
  return seated ? preset : 'teaching';
}
/** Where the barista hosts: the chair they picked, the set's C position, or the script's own spot when no set is up. */
export const hostSpotOf = (project: Pick<StudioProject, 'set' | 'host'>, scriptSpot: string) => project.set ? project.host ?? STUDIO_SET_SPOT : scriptSpot;

/** What every room viewer's snapshot carries about a laptop's project: who edits, whether work is under way, and its set. */
export interface StudioDesk { furnitureId: string; floorId: FloorId; revision: number; editorId: string | null; working: boolean; set: StudioSet | null; host: string | null }

const studioKeyKinds = ['collect_everyday_d04_laptop_open', 'collect_everyday_d06_tablet_stand'] as const;
export function isStudioKey(item: { kind: string; stowed?: boolean }) { return !item.stowed && studioKeyKinds.some(kind => item.kind === kind); }

const id = z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,149}$/);
const sha256 = z.string().regex(/^[a-f0-9]{64}$/);
const beatSchema = z.strictObject({ id, roll: z.enum(['A', 'B']), caption: z.string().trim().max(200), seconds: z.number().positive().max(90) });
const templateSchema = z.strictObject({ repo: z.string().url().max(300), commit: z.string().regex(/^[a-f0-9]{7,40}$/) });
const PREVIEW_MAX_BYTES = 10 * 1024 * 1024;
const previewSchema = z.strictObject({ sha256, bytes: z.number().int().positive().max(PREVIEW_MAX_BYTES) });
const outputSchema = z.strictObject({ sha256, bytes: z.number().int().positive(), durationSec: z.number().positive().max(3600), templateCommit: z.string().regex(/^[a-f0-9]{7,40}$/), scriptRevision: z.number().int().positive() });
type StudioBeat = z.infer<typeof beatSchema>;
type StudioOutput = z.infer<typeof outputSchema>;

export interface StudioProject {
  version: 1; id: string; roomId: string; furnitureId: string; editorId: string | null; revision: number; createdAt: number; updatedAt: number;
  template: z.infer<typeof templateSchema> | null; style: string; storyboard: StudioBeat[]; stages: Record<StudioStage, StageState>;
  preview: z.infer<typeof previewSchema> | null; output: StudioOutput | null; reviewStatus: 'draft' | 'approved';
  /** The barista's performance script; projects saved before S3 have no field, read it as null. */
  performance?: { script: PerformanceScript; by: string; at: number } | null;
  /** The first-short interview task the cafe sent the first editor the barista assigned; once set it is never sent again. */
  interview?: { taskId: string; editorId: string; at: number } | null;
  /** The studio set the barista put up on this floor; projects saved before S9 have no field. */
  set?: StudioSet | null;
  /** A chair the barista picked to host from instead of the set's C position. */
  host?: string | null;
}

const furnitureId = z.string().min(1).max(180);
const requestId = z.string().min(8).max(150);
export const studioSchemas = {
  studio_get: z.strictObject({ furnitureId }),
  studio_update: z.strictObject({
    furnitureId, requestId, expectedRevision: z.number().int().nonnegative(),
    editorId: z.string().min(1).max(150).nullable().optional(), template: templateSchema.nullable().optional(), style: z.string().trim().max(500).optional(),
    storyboard: z.array(beatSchema).max(60).optional(), preview: previewSchema.nullable().optional(),
    locale: z.enum(locales).optional(),
  }),
  studio_stage: z.strictObject({
    furnitureId, requestId, expectedRevision: z.number().int().positive(), stage: z.enum(STUDIO_STAGES), action: z.enum(['start', 'finish', 'fail', 'reset']),
    note: z.string().trim().max(500).optional(), error: z.string().trim().min(1).max(500).optional(), output: outputSchema.optional(),
  }),
  studio_script: z.strictObject({ furnitureId, requestId, expectedRevision: z.number().int().nonnegative(), script: z.unknown() }),
  studio_bundle: z.strictObject({ furnitureId }),
  studio_set: z.strictObject({
    furnitureId, requestId, expectedRevision: z.number().int().nonnegative(), action: z.enum(['up', 'down', 'host']),
    preset: z.enum(STUDIO_SET_PRESETS).optional(), host: z.string().min(1).max(180).nullable().optional(),
  }),
};
export type StudioTool = keyof typeof studioSchemas;
export const studioDescriptions: Record<StudioTool, string> = {
  studio_get: 'Read the self-media project on a placed laptop or tablet stand in an upstairs room: assigned editor, storyboard summary, the seven stage states and output metadata. project is null until the first studio_update. cast.sheet says whether the barista has a serving sheet and can perform; cast.seated whether they also have a seated sheet. Needs room interact access.',
  studio_update: 'Create or edit the self-media project on a placed laptop or tablet stand. Pass expectedRevision (0 to create) and a stable requestId; retrying the same requestId returns the first answer. A resident may assign only itself as editor; the cafe stores metadata only, never the video. When the barista first assigns an editor, the cafe sends that resident the first-short interview task once; write the answers into style, one "key: answer" per line. To show the barista a preview, send it as an MP4 attachment to house-owner (scope this room); the laptop plays the newest video the editor sent and shows that same conversation, where the barista replies and answers question cards.',
  studio_script: 'Upload the barista\'s performance script for this project; the room plays it when the owner presses the rehearsal button, and the A-roll capture plays the same script. script is {version:1, format:{width:1080,height:1920,fps:30}, spot, cues}. spot is the id of a piece placed in this room (the laptop or its desk); the barista performs behind it. While the barista has a studio set up (studio_set), they host from the set, or the chair they picked, instead. Each cue is {at, until, act, line?, camera?} in seconds: act is idle, greet, brew, serve or wipe (a cue longer than the act repeats it), line is the caption, camera is {zoom 1-3, focus host|spot}. Cues must not overlap and the show ends by 90 s. A rejected script lists every problem with its path. Saving marks the script stage done. Pass expectedRevision (0 creates the project) and a stable requestId.',
  studio_bundle: 'Download the performance bundle for recording the A-roll on the owner\'s own computer: the stored script, this room\'s furniture and stairs, the barista\'s look, and short-lived links to the barista art with their SHA-256. Save the JSON and run the recording command with --bundle <file> before expiresAt; after that, download a fresh bundle. Needs a stored script and room interact access.',
  studio_set: 'The barista only: put up a studio set on the laptop\'s floor (action up, preset presenter, gaming or teaching), take it down to bring the room back as it was (down), or pick where the barista hosts (host: a chair id in this room, or null for the set\'s C position). Furniture under the set is covered, never moved. While a set is up the barista hosts from it, whatever spot the script names; studio_get and studio_bundle carry it. Pass expectedRevision and a stable requestId.',
  studio_stage: 'Move one stage (interview, script, aroll, broll, edit, render, review) with start, finish, fail or reset. finish on render needs output {sha256, bytes, durationSec, templateCommit, scriptRevision}; finish on interview needs a barista with a serving sheet; only the owner finishes review. Pass expectedRevision and a stable requestId.',
};

type StudioEdit = Omit<z.infer<typeof studioSchemas.studio_update>, 'furnitureId' | 'requestId' | 'expectedRevision' | 'locale'>;
export type StudioEvent =
  | { kind: 'edit'; edit: StudioEdit; at: number }
  | { kind: 'script'; script: PerformanceScript; by: string; at: number }
  | { kind: 'interview'; taskId: string; editorId: string; by: string; at: number }
  | { kind: 'set'; set: StudioSet | null; at: number }
  | { kind: 'host'; host: string | null; at: number }
  | { kind: 'stage'; stage: StudioStage; action: 'start' | 'finish' | 'fail' | 'reset'; by: string; at: number; note?: string; error?: string; output?: StudioOutput };

export class StudioTransitionError extends Error {
  readonly code: 'STUDIO_TRANSITION' | 'STUDIO_OUTPUT';
  constructor(code: StudioTransitionError['code'], message: string) { super(message); this.code = code; }
}

/**
 * Whether the barista can perform, as the room draws them (src/room/barista.ts baristaBodies): a custom serving sheet plays;
 * a custom standee without one covers the built-in art; of the built-in baristas only gpt ships a serving sheet.
 */
export function baristaCanPerform(character: Character, look: BaristaAppearance | undefined) {
  return Boolean(look?.sheet) || !look?.standee && character === 'gpt';
}

export function newStudioProject(input: { id: string; roomId: string; furnitureId: string; at: number }): StudioProject {
  return {
    version: 1, id: input.id, roomId: input.roomId, furnitureId: input.furnitureId, editorId: null, revision: 0, createdAt: input.at, updatedAt: input.at,
    template: null, style: '', storyboard: [], stages: Object.fromEntries(STUDIO_STAGES.map(stage => [stage, { status: 'todo' }])) as StudioProject['stages'],
    preview: null, output: null, reviewStatus: 'draft', performance: null, interview: null,
  };
}

const moves: Record<'start' | 'finish' | 'fail' | 'reset', readonly StageState['status'][]> = {
  start: ['todo', 'done', 'failed'], finish: ['running'], fail: ['running'], reset: ['running', 'done', 'failed'],
};

/** Every change to a project goes through here; it returns a new project one revision ahead or throws StudioTransitionError. */
export function reduceStudio(project: StudioProject, event: StudioEvent): StudioProject {
  const next: StudioProject = { ...project, stages: { ...project.stages }, revision: project.revision + 1, updatedAt: event.at };
  if (event.kind === 'edit') {
    const { edit } = event;
    if (edit.editorId !== undefined) next.editorId = edit.editorId;
    if (edit.template !== undefined) next.template = edit.template;
    if (edit.style !== undefined) next.style = edit.style;
    if (edit.storyboard !== undefined) next.storyboard = edit.storyboard;
    if (edit.preview !== undefined) next.preview = edit.preview;
    if (edit.template !== undefined || edit.style !== undefined || edit.storyboard !== undefined) unapprove(next);
    return next;
  }
  if (event.kind === 'interview') {
    next.interview = { taskId: event.taskId, editorId: event.editorId, at: event.at };
    if (project.stages.interview.status === 'todo') next.stages.interview = { status: 'running', since: event.at, by: event.by };
    return next;
  }
  if (event.kind === 'set') { next.set = event.set; next.host = null; return next; }
  if (event.kind === 'host') { next.host = event.host; return next; }
  if (event.kind === 'script') {
    next.performance = { script: event.script, by: event.by, at: event.at };
    next.stages.script = { status: 'done', at: event.at, by: event.by };
    unapprove(next);
    return next;
  }
  const from = project.stages[event.stage].status;
  if (!moves[event.action].includes(from)) throw new StudioTransitionError('STUDIO_TRANSITION', `The ${event.stage} stage is ${from}; it cannot ${event.action}.`);
  if (event.action === 'fail' && !event.error) throw new StudioTransitionError('STUDIO_TRANSITION', 'Say why the stage failed in error.');
  if (event.output && !(event.stage === 'render' && event.action === 'finish')) throw new StudioTransitionError('STUDIO_OUTPUT', 'Only finishing the render stage records output.');
  if (event.stage === 'render' && event.action === 'finish' && !event.output) throw new StudioTransitionError('STUDIO_OUTPUT', 'Finishing render needs the output hash, size, length, template commit and script revision.');
  if (event.stage === 'review' && event.action !== 'reset' && project.stages.render.status !== 'done') throw new StudioTransitionError('STUDIO_TRANSITION', 'Review comes after the render stage is done.');
  next.stages[event.stage] =
    event.action === 'start' ? { status: 'running', since: event.at, by: event.by }
    : event.action === 'finish' ? { status: 'done', at: event.at, by: event.by, ...(event.note ? { note: event.note } : {}) }
    : event.action === 'fail' ? { status: 'failed', at: event.at, by: event.by, error: event.error! }
    : { status: 'todo' };
  if (event.stage === 'render') { next.output = event.action === 'finish' ? event.output! : null; if (event.action !== 'finish') unapprove(next); }
  if (event.stage === 'review') next.reviewStatus = event.action === 'finish' ? 'approved' : 'draft';
  return next;
}
function unapprove(project: StudioProject) {
  project.reviewStatus = 'draft';
  if (project.stages.review.status === 'done') project.stages.review = { status: 'todo' };
}

/**
 * Everything the recording stage needs to play one script in one upstairs room, without the cafe's source or a login.
 * `assets` are the barista art the room loads from `/media/<key>`; the recorder downloads each link, checks its SHA-256
 * and serves those bytes to the stage. Links stop working at `expiresAt`.
 */
export interface PerformanceBundle {
  version: 1; house: string; furnitureId: string; projectRevision: number; expiresAt: number; stageUrl: string;
  script: PerformanceScript;
  room: { id: string; floorId: FloorId; finish: RoomFinishChoice; brightness?: number; stairs: RoomFurnitureItem[]; set?: StudioSet };
  furniture: RoomFurnitureItem[];
  barista: { character: Character; appearance: BaristaAppearance | null };
  assets: { kind: BaristaLookKind; key: string; url: string; sha256: string }[];
}
