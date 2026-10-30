import { ownerSenderId, type AgentState, type Presence } from '../../shared/domain';
import type { EnergyPose } from './energy';
import type { Visit, VisitKind } from './overlay';
import { blocked, clear, findPath, nearestFree, roomNav, walkSegment, type Nav } from './nav';
import { crowdRoute, type Peer, type Yield } from './crowd';
import { roomLayout, type Activity, type Poi } from './roomLayout';
import type { CelebrationEvent } from './celebrationFixtures';
import { CELEBRATION_MS } from './timeline';


export type Facing = 'S' | 'SW' | 'W' | 'NW' | 'N' | 'NE' | 'E' | 'SE';

export type Action = 'walk' | 'idle' | 'work' | 'celebrate' | 'tired' | 'sleep';
type BehaviorMode = 'wander' | 'toDesk' | 'working' | 'tired' | 'sleeping' | 'celebrating' | 'visiting' | 'dozing' | 'leaving';
export interface Vec { x: number; z: number }
export interface Hold { kind: 'sit' | 'work' | 'stay'; until: number }
export interface Motion { position: Vec; target: Vec; path?: Vec[]; navRevision?: string; yielding?: Yield; crowdRetryAt?: number; routeRetryAt?: number; facing: Facing; pauseUntil: number; mode: BehaviorMode; time: number; slot?: string; look?: Vec; activity?: Activity; arrivedAt?: number; hold?: Hold }
const WALK_SPEED = 1;
const TIRED_SPEED = 0.5;
const ARRIVE = 0.05;
const MAX_DT = 1;
const VISIT_GAP = 1.1;
const STAY_MS = 6000, STAY_MORE_MS = 9000;
const SPEAK_MS = 600;
const REACT_MS = 2500;
const ASIDE_MS = 2500;
const PENDING_CAP = 2;
const ROOM_GAP = 1.2;
const SCREEN_GAP = 1.4;
const ROUTE_SLACK = .25;

type VisitPhase = 'approach' | 'speak' | 'react';
type VisitRole = 'caller' | 'host' | 'aside' | 'mail' | 'deliver';
interface VisitOrder { id: string; role: VisitRole; kind: VisitKind; preview: string; phase: VisitPhase; spot: Vec; lookAt: Vec; since: number; asideText?: string }
interface StepInput {
  agent: { id?: string; state: AgentState; presence?: Presence; reachable?: boolean };
  pose: EnergyPose;
  position: Vec;
  time: number;
  station: Vec;
  sofa: Vec;
  busy: boolean;
  reduced: boolean;
  random?: () => number;
  view?: Vec;
  visit?: VisitOrder;
  nav?: Nav;
  others?: Vec[];
  door?: Vec;
  sofaSlot?: string;
  pois?: readonly Poi[];
  taken?: readonly string[];
  cheer?: Cheer;
  peers?: readonly Peer[];
}

type ModeInput = Pick<StepInput, 'agent' | 'pose' | 'busy'>;
const modeRules: { mode: BehaviorMode; when: (input: ModeInput) => boolean }[] = [
  { mode: 'leaving', when: input => input.agent.presence === 'left' },
  { mode: 'dozing', when: input => input.agent.presence === 'unavailable' || input.agent.presence === 'silent' || input.agent.reachable === false },
  { mode: 'celebrating', when: input => input.agent.state === 'celebrating' },
  { mode: 'sleeping', when: input => input.pose === 'rest' },
  { mode: 'toDesk', when: input => input.agent.state === 'working' || input.busy },
  { mode: 'tired', when: input => input.pose === 'tired' },
  { mode: 'wander', when: () => true },
];
const arrivedAction: Record<BehaviorMode, Action> = { wander: 'idle', tired: 'tired', toDesk: 'work', working: 'work', sleeping: 'sleep', celebrating: 'celebrate', visiting: 'idle', dozing: 'sleep', leaving: 'idle' };
const movingAction: Record<BehaviorMode, Action> = { wander: 'walk', tired: 'tired', toDesk: 'walk', working: 'work', sleeping: 'walk', celebrating: 'celebrate', visiting: 'walk', dozing: 'walk', leaving: 'walk' };
export const compass = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'] as const satisfies readonly Facing[];
const reactionMark: Record<VisitKind, string> = { task: '!', message: '…', result: '✓' };

export function facingOf(dx: number, dz: number, view: Vec = { x: 0, z: 1 }): Facing {
  const len = Math.hypot(view.x, view.z) || 1;
  const south = { x: view.x / len, z: view.z / len };
  const east = { x: south.z, z: -south.x };
  const north = { x: -south.x, z: -south.z };
  const screenX = dx * east.x + dz * east.z;
  const screenY = dx * north.x + dz * north.z;
  if (screenX === 0 && screenY === 0) return 'S';
  const octant = Math.round(Math.atan2(screenX, screenY) / (Math.PI / 4));
  return compass[((octant % 8) + 8) % 8];
}

function modeFor(input: ModeInput): BehaviorMode {
  for (const rule of modeRules) if (rule.when(input)) return rule.mode;
  return 'wander';
}
function near(a: Vec, b: Vec) { return Math.hypot(a.x - b.x, a.z - b.z) < ARRIVE; }
function floorPoint(random: () => number, nav: Nav, others: Vec[] = []): Vec {
  const { minX, maxX, minZ, maxZ } = nav.bounds;
  const ok = (p: Vec) => !blocked(nav, p) && others.every(o => Math.hypot(o.x - p.x, o.z - p.z) >= ROOM_GAP);
  let first: Vec | undefined;
  for (let tries = 0; tries < 8; tries++) {
    const p = { x: minX + random() * (maxX - minX), z: minZ + random() * (maxZ - minZ) };
    first ??= p;
    if (ok(p)) return p;
  }
  return nearestFree(nav, first!, ok) ?? nearestFree(nav, first!) ?? first!;
}
function pauseMs(random: () => number) { return 2000 + Math.floor(random() * 4001); }
const screenX = (p: Vec, view: Vec) => (p.x * view.z - p.z * view.x) / (Math.hypot(view.x, view.z) || 1);
function pickSpot(random: () => number, pois: readonly Poi[], taken: readonly string[], leaving?: string, others: readonly Vec[] = [], view: Vec = { x: 0, z: 1 }) {
  const open = pois.flatMap(poi => poi.spots.map((spot, k) => ({ key: `${poi.id}:${k}`, spot: { x: spot.x, z: spot.z }, look: spot.look ?? poi.look, activity: poi.activity })))
    .filter(choice => choice.key !== leaving && !taken.includes(choice.key));
  if (!open.length) return null;
  const spread = (choice: typeof open[number]) => Math.min(Infinity, ...others.map(o => Math.abs(screenX(choice.spot, view) - screenX(o, view))));
  const clear = open.filter(choice => spread(choice) >= SCREEN_GAP);
  const pool = clear.length ? clear : [open.reduce((best, choice) => spread(choice) > spread(best) ? choice : best)];
  return pool[Math.min(pool.length - 1, Math.floor(random() * pool.length))];
}
function route(prev: Motion | undefined, from: Vec, target: Vec, nav: Nav, time: number): Vec[] {
  if (prev?.navRevision === nav.revision && near(prev.target, target) && (prev.routeRetryAt ?? 0) > time) return [];
  if (near(from, target)) return [];
  const path = prev?.navRevision === nav.revision ? prev.path : undefined;
  if (path?.length) {
    const end = path[path.length - 1];
    if (near(end, target)) return path;
    if (Math.hypot(end.x - target.x, end.z - target.z) < ROUTE_SLACK && clear(nav, path.length > 1 ? path[path.length - 2] : from, target)) return [...path.slice(0, -1), { ...target }];
  }
  return findPath(nav, from, target);
}
function follow(nav: Nav, from: Vec, path: Vec[], distance: number) {
  let at = { ...from }; let rest = path; let left = distance;
  while (rest.length && left > 0) {
    const next = rest[0]; const dist = Math.hypot(next.x - at.x, next.z - at.z);
    if (dist < 1e-8) { rest = rest.slice(1); continue; }
    const step = Math.min(dist, left), candidate = { x: at.x + (next.x - at.x) / dist * step, z: at.z + (next.z - at.z) / dist * step };
    const moved = walkSegment(nav, at, candidate, true); const stopped = Math.hypot(moved.x - candidate.x, moved.z - candidate.z) > 1e-5;
    at = moved; left -= step;
    if (stopped) break;
    if (dist <= step) rest = rest.slice(1);
  }
  return { position: at, path: rest };
}
function retryAt(prev: Motion | undefined, nav: Nav, path: Vec[], position: Vec, target: Vec, time: number) {
  if (path.length || near(position, target)) return undefined;
  return prev?.navRevision === nav.revision && near(prev.target, target) && (prev.routeRetryAt ?? 0) > time ? prev?.routeRetryAt : time + 500;
}
const heading = (from: Vec, path: Vec[], target: Vec) => path.find(point => !near(point, from)) ?? target;

function beside(from: Vec, to: Vec, view: Vec = { x: 0, z: 1 }, nav: Nav = roomNav(), gap = VISIT_GAP): Vec {
  const len = Math.hypot(view.x, view.z) || 1;
  const right = { x: view.z / len, z: -view.x / len };
  const preferred = (from.x - to.x) * right.x + (from.z - to.z) * right.z < 0 ? -1 : 1;
  const at = (side: number) => ({ x: to.x + right.x * side * gap, z: to.z + right.z * side * gap });
  const first = at(preferred), second = at(-preferred);
  return !blocked(nav, first) ? first : !blocked(nav, second) ? second : nearestFree(nav, first) ?? first;
}

const DESK_SIDE = 1.15;
export function workSpot(seat: Vec, desk: Vec | undefined, seated: boolean, nav: Nav = roomNav()): Vec {
  if (seated) return { ...seat };
  const across = desk && Math.abs(seat.x - desk.x) >= Math.abs(seat.z - desk.z) ? { x: 0, z: DESK_SIDE } : { x: DESK_SIDE, z: 0 };
  const sides = desk ? [{ x: desk.x + across.x, z: desk.z + across.z }, { x: desk.x - across.x, z: desk.z - across.z }] : [];
  return [...sides, seat].find(spot => !blocked(nav, spot)) ?? nearestFree(nav, seat) ?? { ...seat };
}

export function openSpot(spot: Vec, nav: Nav = roomNav()): Vec {
  return !blocked(nav, spot) ? { ...spot } : nearestFree(nav, spot) ?? { ...spot };
}

interface ActiveVisit { visit: Visit; phase: VisitPhase; since: number; spot: Vec; owner: boolean; deliver?: boolean; held?: number }
interface SenderState { pending: Visit[]; active: ActiveVisit | null; aside: { visit: Visit; until: number; held?: number } | null }
export interface VisitWorld { senders: Record<string, SenderState> }
export interface TalkBubble { agentId: string; variant: 'mail' | 'speech' | 'react' | 'emote'; text: string }
export type StepResult = { motion: Motion; target: Vec; speed: number; facing: Facing; action: Action; mode: BehaviorMode; hop?: boolean; gone?: boolean; activity?: Activity; since?: number };

export function emptyVisits(): VisitWorld { return { senders: {} }; }

export function acceptVisit(world: VisitWorld, visit: Visit, now: number): VisitWorld {
  const current = world.senders[visit.from] ?? { pending: [], active: null, aside: null };
  if (current.pending.length >= PENDING_CAP) return { senders: { ...world.senders, [visit.from]: { ...current, aside: { visit, until: now + ASIDE_MS } } } };
  return { senders: { ...world.senders, [visit.from]: { ...current, pending: [...current.pending, visit] } } };
}

const gapFor = (visit: Visit, widths?: Record<string, number>) => widths?.[visit.from] && widths[visit.to] ? (widths[visit.from] + widths[visit.to]) / 2 + .1 : VISIT_GAP;
function beginVisit(visit: Visit, places: Record<string, Vec>, now: number, reduced: boolean, view?: Vec, nav?: Nav, widths?: Record<string, number>): ActiveVisit | 'wait' | 'drop' {
  if (visit.to === ownerSenderId) return !places[visit.from] || reduced ? 'drop' : { visit, phase: 'approach', since: now, spot: { ...roomLayout.counter.spot }, owner: false, deliver: true };
  if (!places[visit.to]) return 'drop';
  if (visit.from === ownerSenderId) return { visit, phase: 'react', since: now, spot: places[visit.to], owner: true };
  if (!places[visit.from]) return 'wait';
  if (reduced) return { visit, phase: 'speak', since: now, spot: places[visit.from], owner: false };
  return { visit, phase: 'approach', since: now, spot: beside(places[visit.from], places[visit.to], view, nav, gapFor(visit, widths)), owner: false };
}

export function tickVisits(world: VisitWorld, places: Record<string, Vec>, now: number, reduced: boolean, view?: Vec, nav?: Nav, widths?: Record<string, number>, cheering?: ReadonlySet<string>) {
  const senders: Record<string, SenderState> = {};
  const orders: Record<string, VisitOrder> = {};
  for (const [id, sender] of Object.entries(world.senders)) {
    let { pending, active, aside } = sender;
    const cheers = Boolean(cheering?.has(id));
    if (aside && cheers) aside = { ...aside, held: aside.held ?? aside.until - now };
    else if (aside?.held !== undefined) aside = { visit: aside.visit, until: now + aside.held };
    if (aside && aside.until <= now && !cheers) aside = null;
    if (!active && pending.length) {
      const started = beginVisit(pending[0], places, now, reduced, view, nav, widths);
      if (started === 'drop') pending = pending.slice(1);
      else if (started !== 'wait') { active = started; pending = pending.slice(1); }
    }
    const holding = Boolean(active && !active.owner && cheering?.has(active.visit.from));
    if (active && holding) active = { ...active, held: active.held ?? now - active.since };
    else if (active?.held !== undefined) { const { held, ...rest } = active; active = { ...rest, since: now - held }; }
    if (!holding && active?.phase === 'approach') {
      const from = places[active.visit.from];
      const to = places[active.visit.to];
      if (reduced) active = active.deliver ? null : { ...active, phase: 'speak', since: now, spot: from ?? active.spot };
      else {
        if (from && to && !active.deliver) active = { ...active, spot: beside(from, to, view, nav, gapFor(active.visit, widths)) };
        if (from && near(from, active.spot)) active = { ...active, phase: 'speak', since: now };
      }
    } else if (!holding && active?.phase === 'speak' && now - active.since >= SPEAK_MS) active = active.deliver ? null : { ...active, phase: 'react', since: now };
    else if (!holding && active?.phase === 'react' && now - active.since >= REACT_MS) active = null;
    if (!active && pending.length) {
      const started = beginVisit(pending[0], places, now, reduced, view, nav, widths);
      if (started === 'drop') pending = pending.slice(1);
      else if (started !== 'wait') { active = started; pending = pending.slice(1); }
    }
    senders[id] = { pending, active, aside };
    if (active) {
      const lookAt = places[active.visit.to] ?? active.spot;
      if (active.owner) orders[active.visit.to] = { id: active.visit.id, role: 'mail', kind: active.visit.kind, preview: active.visit.preview, phase: active.phase, spot: active.spot, lookAt, since: active.since };
      else if (active.deliver) orders[active.visit.from] = { id: active.visit.id, role: 'deliver', kind: active.visit.kind, preview: active.visit.preview, phase: active.phase, spot: active.spot, lookAt: { ...roomLayout.counter.look }, since: active.since };
      else {
        orders[active.visit.from] = { id: active.visit.id, role: 'caller', kind: active.visit.kind, preview: active.visit.preview, phase: active.phase, spot: active.spot, lookAt, since: active.since, asideText: active.phase === 'approach' && aside ? aside.visit.preview : undefined };
        orders[active.visit.to] = { id: active.visit.id, role: 'host', kind: active.visit.kind, preview: active.visit.preview, phase: active.phase, spot: places[active.visit.to] ?? lookAt, lookAt: places[active.visit.from] ?? active.spot, since: active.since };
      }
    }
    if (aside && !orders[id]) orders[id] = { id: aside.visit.id, role: 'aside', kind: aside.visit.kind, preview: aside.visit.preview, phase: 'speak', spot: places[id] ?? { x: 0, z: 0 }, lookAt: places[id] ?? { x: 0, z: 0 }, since: aside.until - ASIDE_MS };
  }
  return { world: { senders }, orders };
}

export function delivering(world: VisitWorld) {
  return new Set(Object.values(world.senders).flatMap(sender => sender.active?.deliver && sender.active.phase === 'approach' ? [sender.active.visit.id] : []));
}

export function talkBubbles(orders: Record<string, VisitOrder>): TalkBubble[] {
  const bubbles: TalkBubble[] = [];
  for (const [agentId, order] of Object.entries(orders)) {
    if (order.role === 'mail') bubbles.push({ agentId, variant: 'mail', text: '' });
    else if (order.asideText) bubbles.push({ agentId, variant: 'speech', text: order.asideText });
    else if (order.role === 'aside' || (order.role === 'caller' && order.phase !== 'approach')) bubbles.push({ agentId, variant: 'speech', text: order.preview });
    else if (order.role === 'host' && order.phase === 'react') bubbles.push({ agentId, variant: 'react', text: reactionMark[order.kind] });
  }
  return bubbles;
}

function stand(position: Vec, facing: Facing, time: number, mode: BehaviorMode, action: Action): StepResult {
  const motion: Motion = { position: { ...position }, target: { ...position }, facing, pauseUntil: time, mode, time };
  return { motion, target: motion.target, speed: 0, facing, action, mode };
}

function decorate(result: StepResult, input: StepInput): StepResult {
  const order = input.visit;
  if (!order || (order.role !== 'host' && order.role !== 'mail') || result.mode === 'dozing' || result.mode === 'leaving') return result;
  if (order.role === 'mail') return { ...result, hop: !input.reduced };
  const view = input.view ?? { x: 0, z: 1 };
  const facing = facingOf(order.lookAt.x - result.motion.position.x, order.lookAt.z - result.motion.position.z, view);
  const seated = result.mode === 'working' || result.mode === 'sleeping' || result.mode === 'celebrating' || result.mode === 'toDesk';
  if (seated) return { ...result, facing, motion: { ...result.motion, facing } };
  return stand(result.motion.position, facing, input.time, result.mode, arrivedAction[result.mode]);
}

function stepCaller(prev: Motion | undefined, input: StepInput, order: VisitOrder): StepResult {
  const view = input.view ?? { x: 0, z: 1 };
  const position0 = prev?.position ?? input.position;
  if (input.reduced || order.phase !== 'approach') {
    const facing = facingOf(order.lookAt.x - position0.x, order.lookAt.z - position0.z, view);
    return stand(position0, facing, input.time, 'visiting', 'idle');
  }
  const dt = prev ? Math.min(MAX_DT, Math.max(0, (input.time - prev.time) / 1000)) : 0;
  const nav = input.nav ?? roomNav();
  const avoidance = crowdRoute(nav, prev, position0, order.spot, input.agent.id, input.peers, input.time);
  const { path: detour, ...recovery } = avoidance;
  const path = detour ?? route(prev, position0, avoidance.yielding?.point ?? order.spot, nav, input.time);
  const walked = follow(nav, position0, path, WALK_SPEED * dt);
  const arrived = near(walked.position, order.spot);
  const position = arrived ? { ...order.spot } : walked.position;
  const toward = heading(position0, path, order.spot);
  const facing = arrived ? facingOf(order.lookAt.x - order.spot.x, order.lookAt.z - order.spot.z, view) : facingOf(toward.x - position0.x, toward.z - position0.z, view);
  const motion: Motion = { position, target: { ...order.spot }, path: arrived ? [] : walked.path, navRevision: nav.revision, routeRetryAt: retryAt(prev, nav, path, position, order.spot, input.time), ...recovery, facing, pauseUntil: input.time, mode: 'visiting', time: input.time };
  return { motion, target: motion.target, speed: arrived || !path.length ? 0 : WALK_SPEED, facing, action: arrived || !path.length ? 'idle' : 'walk', mode: 'visiting' };
}

export interface Cheer { event: CelebrationEvent; since: number }
export interface CheerWorld { pending: Record<string, CelebrationEvent[]>; active: Record<string, Cheer>; done: string[]; batch: string[] }
const DONE_CAP = 200;
const cheerKey = (event: CelebrationEvent) => event.kind === 'exchange' ? `exchange:${event.agent}:${event.idempotencyKey}` : `award:${event.txId}`;
const live = (world: CheerWorld, key: string) => Object.values(world.active).some(cheer => cheerKey(cheer.event) === key) || Object.values(world.pending).some(queue => queue.some(event => cheerKey(event) === key));
function trimDone(done: string[], batch: readonly string[]) {
  const keep = new Set(batch); const others = done.filter(key => !keep.has(key));
  if (others.length <= DONE_CAP) return done;
  const drop = new Set(others.slice(0, others.length - DONE_CAP));
  return done.filter(key => !drop.has(key));
}

export function emptyCheers(): CheerWorld { return { pending: {}, active: {}, done: [], batch: [] }; }

export function acceptCheer(world: CheerWorld, event: CelebrationEvent): CheerWorld {
  const key = cheerKey(event);
  if ((event.kind === 'exchange' && event.replayed) || world.done.includes(key) || live(world, key)) return world;
  return { ...world, pending: { ...world.pending, [event.agent]: [...world.pending[event.agent] ?? [], event] } };
}

export function acceptCheers(world: CheerWorld, events: readonly CelebrationEvent[]): CheerWorld {
  const batch = events.map(cheerKey);
  const next = events.reduce(acceptCheer, world);
  return { ...next, batch, done: trimDone(next.done, batch) };
}

export function tickCheers(world: CheerWorld, now: number): CheerWorld {
  const active: Record<string, Cheer> = {}, pending: Record<string, CelebrationEvent[]> = {}; const finished: string[] = [];
  for (const agent of new Set([...Object.keys(world.active), ...Object.keys(world.pending)])) {
    let current: Cheer | undefined = world.active[agent];
    let queue = world.pending[agent] ?? [];
    if (current && now - current.since >= CELEBRATION_MS) { finished.push(cheerKey(current.event)); current = undefined; }
    if (!current && queue.length) { current = { event: queue[0], since: now }; queue = queue.slice(1); }
    if (current) active[agent] = current;
    if (queue.length) pending[agent] = queue;
  }
  return { pending, active, batch: world.batch, done: finished.length ? trimDone([...world.done, ...finished], world.batch) : world.done };
}

export function cheerHolds(input: ModeInput & Pick<StepInput, 'reduced' | 'cheer'>) {
  const chosen = modeFor(input);
  return Boolean(input.cheer) && !input.reduced && chosen !== 'leaving' && chosen !== 'dozing';
}

export function step(prev: Motion | undefined, input: StepInput): StepResult {
  const position0 = prev?.position ?? input.position;
  const chosen = modeFor(input);
  if (cheerHolds(input)) {
    const motion: Motion = prev ? { ...prev, position: { ...position0 }, facing: 'S', time: input.time } : { position: { ...position0 }, target: { ...position0 }, facing: 'S', pauseUntil: input.time, mode: chosen, time: input.time };
    return { motion, target: motion.target, speed: 0, facing: 'S', action: 'idle', mode: motion.mode };
  }
  if (input.visit?.role === 'caller' || input.visit?.role === 'deliver') return stepCaller(prev, input, input.visit);
  if (input.visit?.role === 'aside') return stand(position0, prev?.facing ?? 'S', input.time, prev?.mode === 'visiting' ? 'wander' : prev?.mode ?? 'wander', 'idle');
  const random = input.random ?? Math.random;
  const view = input.view ?? { x: 0, z: 1 };
  const nav = input.nav ?? roomNav();
  if (prev?.hold && input.time < prev.hold.until && (chosen === 'wander' || chosen === 'tired') && input.visit?.role !== 'host') {
    const kept = stand(position0, prev.facing, input.time, chosen, prev.hold.kind === 'work' ? 'work' : 'idle');
    return decorate({ ...kept, motion: { ...kept.motion, hold: prev.hold, pauseUntil: prev.hold.until, ...(prev.slot ? { slot: prev.slot } : {}) } }, input);
  }
  if (input.reduced && prev?.activity && prev.arrivedAt !== undefined && input.time < prev.pauseUntil && prev.mode === chosen && (chosen === 'wander' || chosen === 'tired')) {
    const kept = stand(position0, prev.facing, input.time, chosen, arrivedAction[chosen]);
    const motion: Motion = { ...kept.motion, pauseUntil: prev.pauseUntil, ...(prev.slot ? { slot: prev.slot } : {}), ...(prev.look ? { look: prev.look } : {}), activity: prev.activity, arrivedAt: prev.arrivedAt };
    return decorate({ ...kept, motion, activity: prev.activity, since: prev.arrivedAt }, input);
  }
  if (input.reduced) {
    const mode: BehaviorMode = chosen === 'toDesk' ? 'working' : chosen;
    const motion: Motion = { position: { ...input.station }, target: { ...input.station }, facing: 'S', pauseUntil: input.time, mode, time: input.time };
    return decorate({ motion, target: motion.target, speed: 0, facing: 'S', action: arrivedAction[mode], mode, ...(mode === 'leaving' ? { gone: true } : {}) }, input);
  }
  if (chosen === 'celebrating') {
    const motion: Motion = { position: { ...position0 }, target: { ...position0 }, facing: prev?.facing ?? 'S', pauseUntil: prev?.pauseUntil ?? input.time, mode: 'celebrating', time: input.time };
    return decorate({ motion, target: motion.target, speed: 0, facing: motion.facing, action: 'celebrate', mode: 'celebrating' }, input);
  }
  let mode = chosen;
  let target = prev?.target ?? { ...position0 };
  let pauseUntil = prev?.pauseUntil ?? 0;
  let facing = prev?.facing ?? 'S';
  let place: Pick<Motion, 'slot' | 'look' | 'activity' | 'arrivedAt'> = { slot: prev?.slot, look: prev?.look, activity: prev?.activity, arrivedAt: prev?.arrivedAt };
  if (mode === 'sleeping' || mode === 'dozing') { target = { ...input.sofa }; place = { slot: input.sofaSlot }; }
  else if (mode === 'leaving') { target = { ...(input.door ?? roomLayout.door.outside) }; place = {}; }
  else if (mode === 'toDesk') { target = { ...input.station }; place = {}; }
  else if (!prev || prev.mode !== mode || (input.time >= pauseUntil && near(position0, target))) {
    const pick = input.pois ? pickSpot(random, input.pois, input.taken ?? [], prev?.slot, input.others, input.view) : null;
    target = pick ? pick.spot : floorPoint(random, nav, input.others); pauseUntil = 0;
    place = pick ? { slot: pick.key, look: pick.look, activity: pick.activity } : {};
  }
  if (mode === 'toDesk' && near(position0, target)) mode = 'working';
  const dt = prev ? Math.min(MAX_DT, Math.max(0, (input.time - prev.time) / 1000)) : 0;
  const avoidance = crowdRoute(nav, prev, position0, target, input.agent.id, input.peers, input.time);
  const { path: detour, ...recovery } = avoidance;
  const path = detour ?? route(prev, position0, avoidance.yielding?.point ?? target, nav, input.time);
  const speed = path.length ? mode === 'tired' ? TIRED_SPEED : WALK_SPEED : 0;
  if (path.length) { const toward = heading(position0, path, target); facing = facingOf(toward.x - position0.x, toward.z - position0.z, view); }
  const walked = speed > 0 ? follow(nav, position0, path, speed * dt) : { position: near(position0, target) ? { ...target } : { ...position0 }, path };
  const moved = walked.position;
  const arrived = near(moved, target);
  if (arrived && mode === 'toDesk') mode = 'working';
  if (arrived && (mode === 'wander' || mode === 'tired') && pauseUntil <= input.time) {
    pauseUntil = input.time + (place.activity ? STAY_MS + Math.floor(random() * (STAY_MORE_MS + 1)) : pauseMs(random));
    place = { ...place, arrivedAt: input.time };
  }
  if (arrived && place.look) facing = facingOf(place.look.x - target.x, place.look.z - target.z, view);
  if (arrived && mode === 'working') facing = 'S';
  const seated = mode === 'working' || mode === 'sleeping' || mode === 'toDesk' || mode === 'dozing' || mode === 'leaving';
  const hold = input.visit?.role === 'host' && !seated;
  const position = hold ? { ...position0 } : arrived ? { ...target } : moved;
  const kept = Object.fromEntries(Object.entries(place).filter(([, value]) => value !== undefined)) as typeof place;
  const motion: Motion = { position, target: hold ? { ...position0 } : target, path: hold || arrived ? [] : walked.path, navRevision: nav.revision, routeRetryAt: retryAt(prev, nav, path, position, target, input.time), ...recovery, facing, pauseUntil, mode, time: input.time, ...kept };
  const doing = arrived && place.activity && place.arrivedAt !== undefined ? { activity: place.activity, since: place.arrivedAt } : {};
  return decorate({ motion, target: motion.target, speed: hold || arrived ? 0 : speed, facing, action: (hold || arrived || !speed ? arrivedAction : movingAction)[mode], mode, ...doing, ...(arrived && mode === 'leaving' ? { gone: true } : {}) }, input);
}
