import { z } from 'zod';
import type { FloorId } from './floors.ts';

export type RoomFinishSurface = 'wall' | 'floor';
type RoomFinishPattern = 'limewash' | 'stripe' | 'brick' | 'wainscot' | 'tile' | 'stars' | 'plank' | 'herringbone' | 'checker' | 'terrazzo' | 'marble';
interface RoomFinish { surface: RoomFinishSurface; title: string; pattern: RoomFinishPattern; base: string; accent: string; tier: 'normal' | 'special' }

/** Every room on every floor shares this one batch; the scenery colour stays the free default. */
export const roomFinishCatalog = {
  'wall-oat-limewash': { surface: 'wall', title: 'Oat limewash', pattern: 'limewash', base: '#efe2cc', accent: '#dcc8a8', tier: 'normal' },
  'wall-sage-stripe': { surface: 'wall', title: 'Sage stripe wallpaper', pattern: 'stripe', base: '#e3ead6', accent: '#c3d2b0', tier: 'normal' },
  'wall-red-brick': { surface: 'wall', title: 'Red brick', pattern: 'brick', base: '#b8664b', accent: '#ecd9c6', tier: 'normal' },
  'wall-walnut-wainscot': { surface: 'wall', title: 'Walnut wainscot', pattern: 'wainscot', base: '#f3e6d2', accent: '#8a5a3c', tier: 'normal' },
  'wall-sky-tile': { surface: 'wall', title: 'Sky subway tile', pattern: 'tile', base: '#dbe8ef', accent: '#b5c9d6', tier: 'normal' },
  'wall-starry-night': { surface: 'wall', title: 'Starry night', pattern: 'stars', base: '#2e3a5e', accent: '#f6d98e', tier: 'special' },
  'floor-walnut-plank': { surface: 'floor', title: 'Walnut planks', pattern: 'plank', base: '#8b5b3d', accent: '#6c4329', tier: 'normal' },
  'floor-oak-herringbone': { surface: 'floor', title: 'Oak herringbone', pattern: 'herringbone', base: '#d6a86f', accent: '#b98a52', tier: 'normal' },
  'floor-cafe-checker': { surface: 'floor', title: 'Cafe checkerboard', pattern: 'checker', base: '#f2ece1', accent: '#3d3a3a', tier: 'normal' },
  'floor-terracotta-tile': { surface: 'floor', title: 'Terracotta tile', pattern: 'tile', base: '#c57b57', accent: '#ead5c0', tier: 'normal' },
  'floor-speckled-terrazzo': { surface: 'floor', title: 'Speckled terrazzo', pattern: 'terrazzo', base: '#ece6db', accent: '#9aa59b', tier: 'normal' },
  'floor-gilded-marble': { surface: 'floor', title: 'Gilded marble', pattern: 'marble', base: '#f5f2ed', accent: '#c9a45c', tier: 'special' },
} as const satisfies Record<string, RoomFinish>;
export type RoomFinishId = keyof typeof roomFinishCatalog;
export const roomFinishIds = Object.keys(roomFinishCatalog) as [RoomFinishId, ...RoomFinishId[]];
export const isRoomFinishId = (value: unknown): value is RoomFinishId => typeof value === 'string' && Object.hasOwn(roomFinishCatalog, value);
export const finishesOn = (surface: RoomFinishSurface) => roomFinishIds.filter(id => roomFinishCatalog[id].surface === surface);

const finishOf = (surface: RoomFinishSurface) => z.enum(finishesOn(surface) as [RoomFinishId, ...RoomFinishId[]]);
const roomFinishChoiceSchema = z.strictObject({ wall: finishOf('wall').optional(), floor: finishOf('floor').optional() });
/** One choice per floor, so each room keeps its own; a missing surface uses the free scenery default. */
export const roomFinishesSchema = z.strictObject({ 0: roomFinishChoiceSchema.optional(), 1: roomFinishChoiceSchema.optional() });
export type RoomFinishChoice = z.infer<typeof roomFinishChoiceSchema>;
export type RoomFinishes = z.infer<typeof roomFinishesSchema>;

export const finishOnFloor = (finishes: RoomFinishes | undefined, floor: FloorId): RoomFinishChoice => finishes?.[floor] ?? {};
/** `null` puts the surface back on the free default. */
export function chooseFinish(finishes: RoomFinishes | undefined, floor: FloorId, surface: RoomFinishSurface, id: RoomFinishId | null): RoomFinishes {
  const choice: RoomFinishChoice = { ...finishOnFloor(finishes, floor) }, next: RoomFinishes = { ...finishes };
  if (id) choice[surface] = id as never; else delete choice[surface];
  if (Object.keys(choice).length) next[floor] = choice; else delete next[floor];
  return next;
}
export const finishIdsIn = (finishes: RoomFinishes | undefined): RoomFinishId[] => ([0, 1] as const).flatMap(floor => Object.values(finishOnFloor(finishes, floor)));
