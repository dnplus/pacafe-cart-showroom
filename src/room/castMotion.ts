import { facingOf, type Facing, type Vec } from './behavior';
import { sheetCell } from './sprites';

export type Cue = 'arrival' | 'unboxed' | 'poke' | 'removed';
export interface Actor { at: Vec; route: readonly Stop[]; restUntil: number; moving: boolean; heading: Vec }
export interface Stop extends Vec { wait?: number }
export interface Area { minX: number; maxX: number; minZ: number; maxZ: number }
export interface Beat { cue: Cue; since: number }

export const WALK_SPEED = .8;
const ARRIVE = .04;
const MIN_HOP = .7;
/** The walk cycle on the sheet: column 0 stands, columns 1 to 7 step, one frame every this many milliseconds. */
export const FRAME_MS = 125;

export const newActor = (at: Vec): Actor => ({ at: { ...at }, route: [], restUntil: 0, moving: false, heading: { x: 0, z: 1 } });

const clamp = (value: number, low: number, high: number) => Math.max(low, Math.min(high, value));
export const insideArea = (area: Area, point: Vec): Vec => ({ x: clamp(point.x, area.minX, area.maxX), z: clamp(point.z, area.minZ, area.maxZ) });

const within = (area: Area, point: Vec) => point.x > area.minX && point.x < area.maxX && point.z > area.minZ && point.z < area.maxZ;
/** True when the straight walk from `from` to `to` keeps out of every blocked footprint (checked every 5 cm). */
export function clearWalk(from: Vec, to: Vec, blocked: readonly Area[]) {
  const steps = Math.max(1, Math.ceil(Math.hypot(to.x - from.x, to.z - from.z) / .05));
  for (let i = 1; i <= steps; i++) {
    const point = { x: from.x + (to.x - from.x) * i / steps, z: from.z + (to.z - from.z) * i / steps };
    if (blocked.some(area => within(area, point))) return false;
  }
  return true;
}

export function wanderStop(from: Vec, area: Area, rand: () => number, blocked: readonly Area[] = []): Vec | null {
  for (let tries = 0; tries < 24; tries++) {
    const stop = { x: area.minX + rand() * (area.maxX - area.minX), z: area.minZ + rand() * (area.maxZ - area.minZ) };
    if (Math.hypot(stop.x - from.x, stop.z - from.z) >= MIN_HOP && clearWalk(from, stop, blocked)) return stop;
  }
  return null;
}

export const sendTo = (actor: Actor, stops: readonly Stop[]): Actor => ({ ...actor, route: stops.map(stop => ({ ...stop })), restUntil: 0 });

export interface StepInput { now: number; dt: number; area: Area; rand: () => number; /** Reduced motion, a paused room, or art that cannot walk: the figure stays put. */ still: boolean; /** Furniture footprints, grown by the figure's radius, that strolls keep out of. */ blocked?: readonly Area[]; /** Rest this long (ms, from `rand`) between strolls; 0 turns strolling off. */ stroll: number }

export function stepActor(actor: Actor, input: StepInput): Actor {
  const { now, dt, area, rand, still, stroll, blocked = [] } = input;
  if (still) return { ...actor, moving: false, route: [], at: insideArea(area, actor.at) };
  let { route, restUntil } = actor;
  if (now < restUntil) return { ...actor, moving: false };
  if (!route.length && now >= restUntil && stroll > 0) {
    if (restUntil === 0) restUntil = now + stroll * (.4 + rand());
    else { const stop = wanderStop(actor.at, area, rand, blocked); if (stop) route = [stop]; else restUntil = now + stroll; }
  }
  const target = route[0];
  if (!target) return { ...actor, route, restUntil, moving: false };
  const dx = target.x - actor.at.x, dz = target.z - actor.at.z, gap = Math.hypot(dx, dz), reach = WALK_SPEED * dt;
  if (gap <= Math.max(ARRIVE, reach)) {
    const rest = route.length > 1 ? 0 : stroll * (.6 + rand());
    return { at: { x: target.x, z: target.z }, route: route.slice(1), restUntil: now + Math.max(target.wait ?? 0, rest), moving: false, heading: actor.heading };
  }
  return { at: { x: actor.at.x + dx / gap * reach, z: actor.at.z + dz / gap * reach }, route, restUntil, moving: true, heading: { x: dx / gap, z: dz / gap } };
}

export function actorCell(actor: Actor, view: Vec, now: number) {
  const facing: Facing = actor.moving ? facingOf(actor.heading.x, actor.heading.z, view) : 'S';
  const frame = Math.floor(now / FRAME_MS), cell = sheetCell('four', facing, frame, view, actor.moving);
  return { ...cell, col: actor.moving ? 1 + frame % 7 : 0 };
}

export interface Pose { hop: number; stretch: number; mark: string | null; over: boolean }
const rest: Pose = { hop: 0, stretch: 0, mark: null, over: true };
const marks: Record<Cue, string> = { arrival: '!', unboxed: '♪', poke: '♥', removed: '…' };
const hops: Record<Cue, { count: number; height: number; mark: number }> = { arrival: { count: 1, height: .22, mark: 1300 }, unboxed: { count: 2, height: .3, mark: 1700 }, poke: { count: 1, height: .18, mark: 1100 }, removed: { count: 1, height: .1, mark: 1200 } };
const HOP_MS = 360;

export function beatPose(beat: Beat | undefined, now: number, calm: boolean): Pose {
  if (!beat) return rest;
  const { count, height, mark } = hops[beat.cue], age = now - beat.since;
  const jumping = !calm && age >= 0 && age < count * HOP_MS;
  const phase = jumping ? (age % HOP_MS) / HOP_MS : 0;
  const hop = jumping ? Math.sin(phase * Math.PI) * height : 0;
  const stretch = jumping ? Math.sin(phase * Math.PI) * .05 : 0;
  const shown = age >= 0 && age < mark;
  return { hop, stretch, mark: shown ? marks[beat.cue] : null, over: age >= Math.max(mark, count * HOP_MS) };
}

export const fetchesFromShelf: ReadonlySet<Cue> = new Set<Cue>(['unboxed']);

export interface CartSnapshot { items: number; shelved: number }
export function cartCue(previous: CartSnapshot | null, next: CartSnapshot): Cue | null {
  if (!previous) return null;
  if (next.shelved > previous.shelved) return 'unboxed';
  if (next.items > previous.items) return 'arrival';
  if (next.items < previous.items) return 'removed';
  return null;
}
