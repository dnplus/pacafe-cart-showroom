import { furnitureAccess } from '../../shared/furniture-access';
import type { Room } from '../../shared/rooms';
import { canPlaceInRoom } from '../../shared/room-placement';
import { isStair, openingFootprints, portals } from '../../shared/stairs';
import { floorOf, type FloorId } from '../../shared/floors';
import { defaultFurniture } from '../../shared/starter-furniture';
import { canPlaceOnSurface, nearestSurfacePosition, placementOnSurface, surfacePositionOptions, surfaceRegions } from '../../shared/surface-placement';
import { originalStorageEntries, takeOriginalProduct, type OriginalInventory, type OriginalStorageEntry } from './originalInventory';
import { polygonDistance, polygonsOverlap } from '../../shared/room-geometry';
import { MAX_ROOM_FURNITURE } from '../../shared/furniture-series';
import { collectionFor } from '../../shared/furniture-collections';
import { supportFit } from '../../shared/collection-supports';
import { collectionBarLayouts } from '../../shared/collection-bar-layouts';
import { seatingProfileFor } from '../../shared/seating-profiles';
import { specOf, local, interactionsOf, offered, pieces, type Footprint, type Item, type PieceKind, type Spot, type SurfaceSize, type Turn, type Wall } from './pieces';
import { insetRoomRect, insideWalkable, placementEdge as floorEdge, roomFloor, roomWalls } from '../../shared/room-dimensions';
import { stowableKinds, surfaceHostKinds } from '../../shared/room-settings';
import { cosmeticCatalog, cosmeticFor, type CosmeticId } from '../../shared/house-progression';

export type FurnitureKind = PieceKind;
export type { Footprint, Spot };
export type FurnitureItem = Item;

export const furnitureKinds = Object.fromEntries(Object.values(pieces).map(spec => [spec.kind, {
  variants: spec.variants, turns: spec.turns, mount: spec.mount,
  footprint: spec.footprint[0] ? { rx: spec.footprint[0].rx, rz: spec.footprint[0].rz, shape: spec.footprint[0].shape } : null,
}])) as Record<FurnitureKind, { variants: readonly string[]; turns: boolean; mount: 'floor' | 'wall' | 'surface'; footprint: { rx: number; rz: number; shape: Footprint['shape'] } | null }>;

export const canStow = (item: FurnitureItem) => stowableKinds.has(item.kind) && !item.stowed;

export { defaultFurniture } from '../../shared/starter-furniture';

const WALLS = { back: roomWalls.back, left: roomWalls.left } as const;

export interface Doorway { wall: Wall; inside: Spot; outside: Spot }
export function doorway(items: readonly FurnitureItem[]): Doorway {
  const door = items.find(item => item.kind === 'door' && !item.stowed);
  if (door && door.wall !== 'left') return { wall: 'back', inside: { x: door.x, z: WALLS.back.z + 1.71 }, outside: { x: door.x, z: WALLS.back.z + .46 } };
  const z = door?.z ?? -3.4; return { wall: 'left', inside: { x: Math.round((WALLS.left.x + 1.71) * 100) / 100, z }, outside: { x: Math.round((WALLS.left.x + .46) * 100) / 100, z } };
}
const keepClear = (items: readonly FurnitureItem[]) => {
  const { wall, outside } = doorway(items);
  return [wall === 'left' ? { x: WALLS.left.x + 1.51, z: outside.z, r: .75 } : { x: outside.x, z: WALLS.back.z + 1.51, r: .75 }];
};
const clearOf = (f: Footprint, zone: { x: number; z: number; r: number }) => { if (f.points) return polygonDistance(zone, f.points) >= zone.r; const b = box(f); return Math.hypot(Math.max(b.minX - zone.x, 0, zone.x - b.maxX), Math.max(b.minZ - zone.z, 0, zone.z - b.maxZ)) >= zone.r; };

export function piecesOf(item: FurnitureItem): Footprint[] {
  if (item.stowed || pieces[item.kind].mount !== 'floor') return [];
  return footprintsInRoom(item, specOf(item).footprint);
}
function footprintsInRoom(item: FurnitureItem, footprints: readonly Footprint[]): Footprint[] {
  const odd = item.turn % 2 === 1; const scale = item.kind === 'plant' ? item.size ?? 1 : 1;
  const angle = item.turn * Math.PI / 2, c = Math.round(Math.cos(angle)), s = Math.round(Math.sin(angle));
  return footprints.map(f => ({
    x: item.x + (f.x * c - f.z * s) * scale, z: item.z + (f.x * s + f.z * c) * scale,
    rx: (odd ? f.rz : f.rx) * scale, rz: (odd ? f.rx : f.rz) * scale, shape: f.shape, ...(f.points ? { points: f.points.map(point => ({ x: item.x + point.x * c - point.z * s, z: item.z + point.x * s + point.z * c })) } : {}),
  }));
}
export function floorPlacementFootprints(item: FurnitureItem): Footprint[] {
  if (item.stowed || pieces[item.kind].mount !== 'floor') return [];
  const product = collectionFor(item.kind);
  if (item.kind !== 'rug' && product?.category !== 'rug') return piecesOf(item);
  return footprintsInRoom(item, [{
    x: product ? (product.bounds.min[0] + product.bounds.max[0]) / 2 : 0,
    z: product ? (product.bounds.min[2] + product.bounds.max[2]) / 2 : 0,
    rx: product ? product.dimensions[0] / 2 : 1.6,
    rz: product ? product.dimensions[2] / 2 : 1.6,
    shape: 'rect',
  }]);
}
export function furnitureObstacles(items: readonly FurnitureItem[]): Footprint[] { return items.flatMap(piecesOf); }

const box = (f: Footprint) => ({ minX: f.x - f.rx, maxX: f.x + f.rx, minZ: f.z - f.rz, maxZ: f.z + f.rz });
const polygonOf = (f: Footprint) => f.points ?? (f.shape === 'ellipse'
  ? Array.from({ length: 24 }, (_, i) => ({ x: f.x + f.rx * Math.cos(i * Math.PI / 12), z: f.z + f.rz * Math.sin(i * Math.PI / 12) }))
  : [{ x: f.x - f.rx, z: f.z - f.rz }, { x: f.x + f.rx, z: f.z - f.rz }, { x: f.x + f.rx, z: f.z + f.rz }, { x: f.x - f.rx, z: f.z + f.rz }]);
const overlaps = (a: Footprint, b: Footprint, margin = .06) => {
  const p = box(a), q = box(b);
  if (!(p.minX < q.maxX + margin && q.minX < p.maxX + margin && p.minZ < q.maxZ + margin && q.minZ < p.maxZ + margin)) return false;
  return a.points || b.points ? polygonsOverlap(polygonOf(a), polygonOf(b), margin) : true;
};

interface SurfaceSlot { host: string; slot: number; x: number; y: number; z: number; takes: SurfaceSize; width?: number; depth?: number; rotationY?: number; purpose?: string }
const takes = (item: Pick<FurnitureItem, 'kind' | 'variant' | 'turn'>, slot: SurfaceSlot) => {
  if (item.kind === 'countertop' || slot.width !== undefined || collectionFor(item.kind) || collectionFor(item.variant)) return supportFit(item.kind, item.variant, item.turn, { width: slot.width ?? (slot.takes === 'appliance' ? 1.1 : .65), depth: slot.depth ?? (slot.takes === 'appliance' ? .78 : .65), takes: slot.takes, purpose: slot.purpose, rotationY: slot.rotationY ?? 0 });
  return (pieces[item.kind].size ?? 'small') === slot.takes;
};
function surfaceSlots(items: readonly FurnitureItem[], as?: FurnitureItem): SurfaceSlot[] {
  return items.flatMap(item => {
    const host = as && as.id === item.id ? as : item;
    if (host.stowed || !surfaceHostKinds.has(host.kind)) return [];
    return (specOf(host).surfaces?.(host) ?? []).map(({ takes = 'small', slot: explicit, ...at }, slot) => ({ host: host.id, slot: explicit ?? slot, takes, ...at }));
  });
}
export function slotOf(item: Pick<FurnitureItem, 'on' | 'slot'> & Partial<FurnitureItem>, items: readonly FurnitureItem[], as?: FurnitureItem): SurfaceSlot | null {
  if (item.on && items.some(host=>host.id===item.on && floorOf(host)!==floorOf(item))) return null;
  if (item.surfacePosition) {
    const host = as?.id === item.on ? as : items.find(host => host.id === item.on);
    const at = host && placementOnSurface(item as FurnitureItem, host);
    return at ? { ...at, host: host!.id, slot: item.slot ?? 0, takes: 'small' } : null;
  }
  return surfaceSlots(items, as).find(entry => entry.host === item.on && entry.slot === item.slot) ?? null;
}
function nearestSlot(items: readonly FurnitureItem[], id: string, x: number, z: number, reach = 1.1): SurfaceSlot | null {
  const piece = items.find(item => item.id === id); const kind = piece?.kind; if (!kind) return null;
  const taken = new Set(items.filter(item => item.id !== id && !item.stowed && !item.surfacePosition && pieces[item.kind].mount === 'surface').map(item => `${item.on}:${item.slot}`));
  return surfaceSlots(items).filter(entry => floorOf(items.find(host=>host.id===entry.host)!)===floorOf(piece!) && takes(piece!, entry) && !taken.has(`${entry.host}:${entry.slot}`) && fits({ ...piece!, on: entry.host, slot: entry.slot, surfacePosition: undefined }, items) && Math.hypot(entry.x - x, entry.z - z) <= reach)
    .sort((a, b) => Math.hypot(a.x - x, a.z - z) - Math.hypot(b.x - x, b.z - z))[0] ?? null;
}
function settle(items: FurnitureItem[]): FurnitureItem[] {
  return items.map(item => {
    if (item.stowed || pieces[item.kind].mount !== 'surface') return item;
    const at = slotOf(item, items); return at && (at.x !== item.x || at.z !== item.z) ? { ...item, x: at.x, z: at.z } : item;
  });
}
export function clampInRoom(item: FurnitureItem, x: number, z: number): { x: number; z: number } {
  const spec = specOf(item); const clamp = (v: number, lo: number, hi: number) => Math.max(Math.ceil(lo * 4) / 4, Math.min(Math.floor(hi * 4) / 4, v));
  if (spec.mount === 'wall') {
    const face = WALLS[item.wall ?? 'back']; const half = spec.hang!.width / 2;
    return item.wall === 'left' ? { x: 0, z: clamp(z, face.min + half, face.max - half) } : { x: clamp(x, face.min + half, face.max - half), z: 0 };
  }
  const bounds = floorPlacementFootprints({ ...item, x: 0, z: 0, stowed: false }).map(box);
  return {
    x: clamp(x, floorEdge.minX - (bounds.length ? Math.min(...bounds.map(b => b.minX)) : 0), floorEdge.maxX - (bounds.length ? Math.max(...bounds.map(b => b.maxX)) : 0)),
    z: clamp(z, floorEdge.minZ - (bounds.length ? Math.min(...bounds.map(b => b.minZ)) : 0), floorEdge.maxZ - (bounds.length ? Math.max(...bounds.map(b => b.maxZ)) : 0)),
  };
}

function* floorPositionOptions(item: FurnitureItem): Generator<Spot> {
  if (pieces[item.kind].mount === 'wall') {
    const face = WALLS[item.wall ?? 'back'];
    for (let along = face.min; along <= face.max; along += .25) yield item.wall === 'left' ? { x: 0, z: along } : { x: along, z: 0 };
    return;
  }
  const middle = insetRoomRect(roomFloor, 2.9, 2.4);
  for (let z = middle.minZ; z <= middle.maxZ; z += .5) for (let x = middle.minX; x <= middle.maxX; x += .5) yield { x, z };
  const min = clampInRoom(item, -Infinity, -Infinity), max = clampInRoom(item, Infinity, Infinity);
  for (let z = min.z; z <= max.z; z += .25) for (let x = min.x; x <= max.x; x += .25) yield { x, z };
}

export function fits(item: FurnitureItem, items: readonly FurnitureItem[]) {
  if (item.stowed) return true;
  if (isStair(item) && floorOf(item) !== 0) return false;
  if (isStair(item) && portals(item).some(point=>!insideWalkable(point))) return false;
  const holes = openingFootprints(items, floorOf(item));
  items = items.filter(other => floorOf(other) === floorOf(item));
  const spec = specOf(item);
  if (spec.mount === 'wall') {
    const hang = spec.hang!; const wall = item.wall ?? 'back'; const face = WALLS[wall];
    const along = wall === 'back' ? item.x : item.z;
    if (along - hang.width / 2 < face.min || along + hang.width / 2 > face.max) return false;
    if (wall === 'back' && Math.abs(item.z) > .01) return false;
    if (wall === 'left' && Math.abs(item.x) > .01) return false;
    if (item.kind === 'door' && !keepClear(items.map(other => other.id === item.id ? item : other)).every(zone => furnitureObstacles(items).every(f => clearOf(f, zone)))) return false;
    return !items.some(other => {
      if (other.id === item.id || other.stowed || pieces[other.kind].mount !== 'wall' || (other.wall ?? 'back') !== wall) return false;
      const theirs = pieces[other.kind].hang!; if (theirs.band !== hang.band) return false;
      const otherAlong = wall === 'back' ? other.x : other.z;
      return Math.abs(along - otherAlong) < (hang.width + theirs.width) / 2 - .05 && Math.abs(hang.y - theirs.y) < (hang.height + theirs.height) / 2 - .05;
    });
  }
  if (spec.mount === 'surface') {
    if (item.surfacePosition || items.some(other => other.on === item.on && other.surfacePosition && !other.stowed)) { const host = items.find(host => host.id === item.on); return Boolean(host && canPlaceOnSurface(item, host, items)); }
    const slot = slotOf(item, items);
    return slot !== null && takes(item, slot) && !items.some(other => other.id !== item.id && !other.stowed && other.on === item.on && other.slot === item.slot && pieces[other.kind].mount === 'surface');
  }
  const mine = floorPlacementFootprints(item);
  const product = collectionFor(item.kind);
  if (mine.some(footprint=>holes.some(hole=>overlaps(footprint,hole)))) return false;
  if (item.kind === 'rug' || product?.category === 'rug') {
    return mine.every(f => { const b = box(f); return b.minX >= floorEdge.minX && b.maxX <= floorEdge.maxX && b.minZ >= floorEdge.minZ && b.maxZ <= floorEdge.maxZ; });
  }
  for (const f of mine) {
    const b = box(f); if (b.minX < floorEdge.minX || b.maxX > floorEdge.maxX || b.minZ < floorEdge.minZ || b.maxZ > floorEdge.maxZ) return false;
    if (floorOf(item) === 0 && !keepClear(items).every(zone => clearOf(f, zone))) return false;
  }
  const tucks = (other: FurnitureItem) => (item.kind === 'chair' && other.kind === 'table') || (item.kind === 'table' && other.kind === 'chair');
  const others = furnitureObstacles(items.filter(other => other.id !== item.id && pieces[other.kind].mount === 'floor' && !tucks(other)));
  return !mine.some(f => others.some(o => overlaps(f, o)));
}

const snap = (v: number) => Math.round(v * 4) / 4;
const snapWall = (v: number) => Math.round(v * 4) / 4;

function surfaceFacingTurn(items: readonly FurnitureItem[], host: FurnitureItem): Turn {
  const seat = items.filter(item => !item.stowed && (item.kind === 'chair' || item.kind === 'stool') && Math.hypot(item.x - host.x, item.z - host.z) <= 1.85).sort((a, b) => Math.hypot(a.x - host.x, a.z - host.z) - Math.hypot(b.x - host.x, b.z - host.z))[0];
  if (!seat) return 0;
  const angle = -host.turn * Math.PI / 2, dx = seat.x - host.x, dz = seat.z - host.z;
  const x = dx * Math.cos(angle) - dz * Math.sin(angle), z = dx * Math.sin(angle) + dz * Math.cos(angle);
  return ((Math.round(-Math.atan2(x, z) / (Math.PI / 2)) + 4) % 4) as Turn;
}
export function placeSurfacePosition(items: readonly FurnitureItem[], id: string, hostId: string, position: { x: number; z: number }, turn?: Turn): FurnitureItem[] | null {
  const item = items.find(item => item.id === id), host = items.find(item => item.id === hostId);
  if (!item || !host || floorOf(item)!==floorOf(host) || host.stowed || pieces[item.kind].mount !== 'surface') return null;
  const next = { ...item, on: host.id, slot: 0, surfacePosition: { ...position }, stowed: false, turn: turn ?? item.turn };
  const at = placementOnSurface(next, host); if (!at || !canPlaceOnSurface(next, host, items)) return null;
  return items.map(item => item.id === id ? { ...next, x: at.x, z: at.z } : item);
}

export function moveItem(items: readonly FurnitureItem[], id: string, x: number, z: number): FurnitureItem[] | null {
  const item = items.find(entry => entry.id === id); if (!item || item.stowed) return null;
  const spec = specOf(item);
  if (spec.mount === 'surface') {
    if (item.kind !== 'espressoMachine' && item.kind !== 'grinder') {
      const choice = nearestSurfacePosition(item, items.filter(other => floorOf(other) === floorOf(item)), x, z);
      return choice ? placeSurfacePosition(items, id, choice.hostId, choice.position) : null;
    }
    const at = nearestSlot(items, id, x, z); if (!at) return null;
    return items.map(entry => entry.id === id ? { ...item, on: at.host, slot: at.slot, x: at.x, z: at.z } : entry);
  }
  const next = spec.mount === 'wall'
    ? { ...item, ...(item.wall === 'left' ? { x: 0, z: snapWall(z) } : { x: snapWall(x), z: 0 }) }
    : { ...item, x: snap(x), z: snap(z) };
  if (!fits(next, items)) return null;
  const settled = settle(items.map(entry => entry.id === id ? next : entry));
  return settled.filter(entry => !entry.stowed && entry.on === id).every(entry => fits(entry, settled)) ? settled : null;
}

export function moveToOtherWall(items: readonly FurnitureItem[], id: string): FurnitureItem[] | null {
  const item = items.find(entry => entry.id === id);
  if (!item || item.stowed || pieces[item.kind].mount !== 'wall') return null;
  const sourceWall = item.wall ?? 'back';
  const targetWall: Wall = sourceWall === 'back' ? 'left' : 'back';
  const source = WALLS[sourceWall], target = WALLS[targetWall];
  const sourceAlong = sourceWall === 'back' ? item.x : item.z;
  const relative = (sourceAlong - source.min) / (source.max - source.min);
  const preferred = target.min + relative * (target.max - target.min);
  const positions: number[] = [];
  for (let along = target.min; along <= target.max + .001; along += .25) positions.push(snapWall(along));
  positions.sort((a, b) => Math.abs(a - preferred) - Math.abs(b - preferred));
  for (const along of positions) {
    const next = targetWall === 'back'
      ? { ...item, wall: targetWall, x: along, z: 0 }
      : { ...item, wall: targetWall, x: 0, z: along };
    if (fits(next, items)) return items.map(entry => entry.id === id ? next : entry);
  }
  return null;
}

export function turnItem(items: readonly FurnitureItem[], id: string): FurnitureItem[] | null {
  const item = items.find(entry => entry.id === id); if (!item || item.stowed || !furnitureKinds[item.kind].turns) return null;
  const next = { ...item, turn: ((item.turn + 1) % 4) as Turn };
  if (!fits(next, items)) return null;
  const settled = settle(items.map(entry => entry.id === id ? next : entry));
  return settled.filter(entry => !entry.stowed && entry.on === id).every(entry => fits(entry, settled)) ? settled : null;
}
export function stowItem(items: readonly FurnitureItem[], id: string): FurnitureItem[] | null {
  const item = items.find(entry => entry.id === id); if (!item || !canStow(item)) return null;
  return items.map(entry => entry.id === id || (entry.on === id && !entry.stowed) ? { ...entry, stowed: true } : entry);
}

export function unstowItem(items: readonly FurnitureItem[], id: string, acceptLayout?: (items: readonly FurnitureItem[]) => boolean): FurnitureItem[] | null {
  const item = items.find(entry => entry.id === id); if (!item?.stowed) return null;
  const placed = { ...item }; delete placed.stowed;
  if (pieces[item.kind].mount === 'surface') {
    if (placed.surfacePosition) {
      if (fits(placed, items)) {
        const at = slotOf(placed, items)!;
        return items.map(entry => entry.id === id ? { ...placed, x: at.x, z: at.z } : entry);
      }
      const hosts = items.filter(host => floorOf(host)===floorOf(placed) && !host.stowed && surfaceRegions(host).length).sort((a, b) => Number(b.id === placed.on) - Number(a.id === placed.on));
      for (const host of hosts) {
        const option = surfacePositionOptions(placed, host, items).find(option => option.valid);
        if (option) return placeSurfacePosition(items, id, host.id, option.position);
      }
      return null;
    }
    const at = (fits(placed, items) ? slotOf(placed, items) : null) ?? surfaceSlots(items).find(entry => fits({ ...placed, on: entry.host, slot: entry.slot }, items));
    return at ? items.map(entry => entry.id === id ? { ...placed, on: at.host, slot: at.slot, x: at.x, z: at.z } : entry) : null;
  }
  const candidate = (next: FurnitureItem) => items.map(entry => entry.id === id ? next : entry);
  if (fits(placed, items) && (!acceptLayout || acceptLayout(candidate(placed)))) return candidate(placed);
  for (const point of floorPositionOptions(placed)) {
    const next = { ...placed, ...point };
    if (fits(next, items) && (!acceptLayout || acceptLayout(candidate(next)))) return candidate(next);
  }
  return null;
}

export function restoreDefaultLayout(items: readonly FurnitureItem[]): FurnitureItem[] | null {
  const defaults = new Map(defaultFurniture.map(item => [item.id, item]));
  let next = items.map(item => {
    const target = defaults.get(item.id);
    if (!target || target.kind !== item.kind) return stowableKinds.has(item.kind) ? { ...item, stowed: true } : { ...item };
    if (pieces[item.kind].mount === 'surface') return { ...item, stowed: true };
    const restored = { ...item, x: target.x, z: target.z, turn: target.turn, wall: target.wall };
    if (target.stowed) restored.stowed = true; else delete restored.stowed;
    return restored;
  });
  const bar = next.find(item => item.kind === 'bar' && !item.stowed), layout = bar && collectionBarLayouts[bar.variant];
  if (bar && layout) {
    const deliver = layout.anchors.find(anchor => anchor.id === 'deliver');
    next = next.map(item => {
      const index = item.id === 'stool-1' ? 0 : item.id === 'stool-2' ? 1 : -1;
      const position = layout.stoolPositions?.[index];
      if (item.kind !== 'stool' || item.stowed || !position) return item;
      const point = [...position];
      if (deliver && Math.hypot(point[0] - deliver.position[0], point[2] - deliver.position[2]) < .7) point[0] += point[0] < deliver.position[0] ? -.2 : .2;
      return { ...item, ...local(bar, point[0], point[2]), turn: bar.turn };
    });
  }
  if (next.some(item => !item.stowed && !fits(item, next))) return null;
  for (const target of defaultFurniture.filter(item => pieces[item.kind].mount === 'surface')) {
    const original = next.find(item => item.id === target.id && item.kind === target.kind);
    if (!original) continue;
    const placed = { ...original, turn: target.turn, on: target.on, slot: target.slot };
    delete placed.stowed; delete placed.surfacePosition;
    const slots = surfaceSlots(next).sort((a, b) => Number(b.host === target.on) - Number(a.host === target.on));
    const at = slots.find(slot => fits({ ...placed, on: slot.host, slot: slot.slot }, next));
    if (at) {
      next = next.map(item => item.id === placed.id ? { ...placed, on: at.host, slot: at.slot, x: at.x, z: at.z } : item);
      continue;
    }
    if (!stowableKinds.has(placed.kind)) return null;
    for (const host of next.filter(host => !host.stowed && surfaceRegions(host).length)) {
      const option = surfacePositionOptions(placed, host, next).find(option => option.valid);
      if (!option) continue;
      next = placeSurfacePosition(next, placed.id, host.id, option.position, placed.turn)!;
      break;
    }
  }
  return next.every(item => fits(item, next)) ? next : null;
}

const retiredLooks: Partial<Record<FurnitureKind, Record<string, string>>> = { chair: { cardboard: 'plain', velvet: 'plain' } };
export function lockLooks(items: readonly FurnitureItem[]): FurnitureItem[] {
  const unsupported = new Set(items.filter(item => !Object.hasOwn(pieces, item.kind)).map(item => item.id));
  let previous = -1;
  while (previous !== unsupported.size) {
    previous = unsupported.size;
    for (const item of items) if (item.on && unsupported.has(item.on)) unsupported.add(item.id);
  }
  items = items.filter(item => !unsupported.has(item.id));
  const next = (item: FurnitureItem) => retiredLooks[item.kind]?.[item.variant];
  const looked = items.some(item => next(item)) ? items.map(item => { const variant = next(item); return variant ? { ...item, variant } : item; }) : [...items];
  const doored = looked.some(item => item.kind === 'door') ? looked : [...looked, { ...defaultFurniture.find(item => item.kind === 'door')! }];
  return defaultFurniture.filter(item => pieces[item.kind].size === 'appliance' && !doored.some(other => other.kind === item.kind)).reduce((items, appliance) => {
    const bar = items.find(item => item.kind === 'bar' && !item.stowed); if (!bar) return items;
    const at = surfaceSlots(items).find(slot => slot.host === bar.id && takes(appliance, slot) && fits({ ...appliance, on: bar.id, slot: slot.slot }, items));
    return at ? [...items, { ...appliance, on: bar.id, slot: at.slot, x: at.x, z: at.z }] : items;
  }, doored);
}

export type StorageEntry = OriginalStorageEntry | ({ key: string; kind: FurnitureKind; variant: string; productId?: FurnitureItem['productId'] } & (
  | { source: 'stowed'; id: string }
  | { source: 'owned'; cosmetic: CosmeticId }
  | { source: 'starter' }
  | { source: 'look'; id: string }));
const starterPieces: readonly { kind: FurnitureKind; variant: string }[] = [{ kind: 'deskLamp', variant: 'brass' }, { kind: 'potPlant', variant: 'succulent' }];
export function storageEntries(items: readonly FurnitureItem[], owned: readonly CosmeticId[], inventory: OriginalInventory = []): StorageEntry[] {
  const entries: StorageEntry[] = items.filter(item => item.stowed).map(item => ({ key: `stowed:${item.id}`, kind: item.kind, variant: item.variant, productId: item.productId, source: 'stowed', id: item.id }));
  for (const { kind, variant } of inventory.length ? [] : starterPieces) if (!items.some(item => item.kind === kind)) entries.push({ key: `starter:${kind}`, kind, variant, source: 'starter' });
  for (const cosmetic of owned) {
    const { kind, variant } = cosmeticCatalog[cosmetic];
    if (collectionFor(cosmetic)?.replaces) {
      for (const fixture of items.filter(item => item.kind === kind && item.variant !== variant)) entries.push({ key: `look:${fixture.id}:${variant}`, kind, variant, source: 'look', id: fixture.id });
      continue;
    }
    if (stowableKinds.has(kind)) { if (!items.some(item => item.kind === kind && item.variant === variant)) entries.push({ key: `owned:${cosmetic}`, kind, variant, source: 'owned', cosmetic }); continue; }
    const fixture = items.find(item => item.kind === kind);
    if (fixture && fixture.variant !== variant) entries.push({ key: `look:${fixture.id}:${variant}`, kind, variant, source: 'look', id: fixture.id });
  }
  for (const fixture of items.filter(item => (item.kind === 'bar' || item.kind === 'beanShelf') && item.variant !== 'halloween' && !item.stowed)) {
    entries.push({ key: `look:${fixture.id}:halloween`, kind: fixture.kind, variant: 'halloween', source: 'look', id: fixture.id });
  }
  for (const item of inventory.length ? [] : items) {
    const own = defaultFurniture.find(entry => entry.kind === item.kind)?.variant;
    if ((!stowableKinds.has(item.kind) || collectionFor(item.variant)?.replaces) && own && item.variant !== own && (cosmeticFor(item.kind, item.variant) || item.variant === 'halloween')) entries.push({ key: `look:${item.id}:${own}`, kind: item.kind, variant: own, source: 'look', id: item.id });
  }
  return [...entries, ...originalStorageEntries(items, inventory)];
}
export function equipLook(items: readonly FurnitureItem[], id: string, variant: string): FurnitureItem[] | null {
  const current = items.find(item => item.id === id); if (!current) return null;
  let next = items.map(item => { if (item.id !== id) return { ...item }; const changed = { ...item, variant }; delete changed.productId; return changed; });
  if (current.kind === 'bar') {
    const bar = next.find(item => item.id === id)!, layout = collectionBarLayouts[variant];
    const stools = layout?.stoolPositions ?? [[-1.05, 0, .85], [1.1, 0, .85]];
    const deliver = layout?.anchors.find(anchor => anchor.id === 'deliver');
    let index = 0;
    next = next.map(item => {
      if (item.kind !== 'stool' || item.stowed || Math.hypot(item.x - current.x, item.z - current.z) > 3 || index >= stools.length) return item;
      const point = [...stools[index++]];
      if (deliver && Math.hypot(point[0] - deliver.position[0], point[2] - deliver.position[2]) < .7) point[0] += point[0] < deliver.position[0] ? -.2 : .2;
      return { ...item, ...local(bar, point[0], point[2]), turn: bar.turn };
    });
  }
  next = next.map(item => item.on === id && !item.stowed && !fits(item, next) ? { ...item, stowed: true } : item);
  if (next.some(item => item.stowed && (item.kind === 'espressoMachine' || item.kind === 'grinder'))) return null;
  next = settle(next);
  if (!fits(next.find(item => item.id === id)!, next)) return null;
  if (next.filter(item => !item.stowed && (item.on === id || current.kind === 'bar' && item.kind === 'stool')).some(item => !fits(item, next))) return null;
  return next;
}

function takeOutHere(items: readonly FurnitureItem[], entry: StorageEntry, floorId: FloorId, acceptLayout?: (items: readonly FurnitureItem[]) => boolean): { items: FurnitureItem[]; id: string } | null {
  if (entry.source === 'product') return takeOriginalProduct(items, entry, acceptLayout, floorId);
  if (entry.source === 'owned' && items.some(item => item.kind === entry.kind && item.variant === entry.variant)) return null;
  if ((entry.source === 'owned' || entry.source === 'starter') && items.length >= MAX_ROOM_FURNITURE) return null;
  if (entry.source === 'look') { const next = equipLook(items, entry.id, entry.variant); return next && { items: next, id: entry.id }; }
  if (entry.source === 'stowed') {
    const item = items.find(item => item.id === entry.id);
    const crossingFloors = item && floorOf(item) !== floorId;
    if (crossingFloors && (item.kind === 'door' || isStair(item) || pieces[item.kind].mount === 'surface')) return null;
    const destination = crossingFloors ? items.map(other => other.id === entry.id || other.on === entry.id ? { ...other, floorId } : other) : items;
    const next = unstowItem(destination, entry.id, acceptLayout);
    return next && { items: next, id: entry.id };
  }
  const base = entry.source === 'owned' ? entry.cosmetic : entry.kind;
  let n = 1; while (items.some(item => item.id === `${base}-${n}`)) n++;
  const piece: FurnitureItem = { id: `${base}-${n}`, floorId, kind: entry.kind, variant: entry.variant, x: 0, z: 0, turn: 0, stowed: true };
  if (entry.source === 'owned' && pieces[piece.kind].mount === 'surface' && piece.kind !== 'espressoMachine' && piece.kind !== 'grinder') {
    const all = [...items, piece];
    const hosts = items.filter(host => floorOf(host)===floorId && !host.stowed && surfaceRegions(host).length).sort((a, b) => Number(b.kind === 'table' || collectionFor(b.kind)?.category === 'table') - Number(a.kind === 'table' || collectionFor(a.kind)?.category === 'table'));
    for (const host of hosts) {
      const turn = /laptop/.test(piece.kind) ? surfaceFacingTurn(items, host) : piece.turn;
      const option = surfacePositionOptions({ ...piece, turn, stowed: false }, host, all).find(option => option.valid);
      if (option) { const next = placeSurfacePosition(all, piece.id, host.id, option.position, turn); if (next) return { items: next, id: piece.id }; }
    }
  }
  const next = unstowItem([...items, piece], piece.id, acceptLayout); return next && { items: next, id: piece.id };
}

export function moveToFloor(items: readonly FurnitureItem[], id: string, floorId: FloorId, room?: Room, acceptLayout?: (items: readonly FurnitureItem[]) => boolean): FurnitureItem[] | null {
  const item=items.find(item=>item.id===id);if(!item||room&&items.filter(other=>other.id===id||other.on===id).some(other=>!canPlaceInRoom(other,room))||item.kind==='door'||isStair(item)||pieces[item.kind].mount==='surface')return null;
  for(const point of [{x:item.x,z:item.z},...Array.from({length:81},(_,i)=>({x:-4+(i%9),z:-3+Math.floor(i/9)*.75})),...floorPositionOptions(item)]){
    const next=items.map(other=>other.id===id?{...other,floorId,...(room?{roomId:room.id}:{}),...point}:other.on===id?{...other,floorId,...(room?{roomId:room.id}:{})}:other);
    const carried=settle(next);if(carried.filter(other=>other.id===id||other.on===id).every(other=>fits(other,carried))&&(!acceptLayout||acceptLayout(carried)))return carried;
  }return null;
}
export function takeOut(items: readonly FurnitureItem[], entry: StorageEntry, floorId: FloorId = 0, room?: Room, acceptLayout?: (items: readonly FurnitureItem[]) => boolean): {items:FurnitureItem[];id:string}|null {
  if (floorId !== 0 && isStair(entry)) return null;
  const out=takeOutHere(items,entry,floorId,acceptLayout);if(!out)return null;
  const item=out.items.find(item=>item.id===out.id)!;if(room&&!canPlaceInRoom(item,room))return null;if(floorOf(item)===floorId)return room?{...out,items:out.items.map(other=>other.id===out.id||other.on===out.id?{...other,roomId:room.id}:other)}:out;
  const moved=moveToFloor(out.items,out.id,floorId,room,acceptLayout);return moved?{items:moved,id:out.id}:null;
}

const REACH = 1.85;
export function seating(items: readonly FurnitureItem[]) {
  const available = furnitureAccess({ kind: 'automatic-seating' }).allowed ? items : [];
  const sits = offered(available, 'sit'); const claimed = new Set<string>();
  const work = offered(available, 'work').map(({ item: table, interaction }) => {
    const pick = sits.filter(entry => !claimed.has(entry.item.id) && floorOf(entry.item)===floorOf(table) && Math.hypot(entry.interaction.seat.x - interaction.at.x, entry.interaction.seat.z - interaction.at.z) <= REACH)
      .sort((a, b) => Math.hypot(a.interaction.seat.x - interaction.at.x, a.interaction.seat.z - interaction.at.z) - Math.hypot(b.interaction.seat.x - interaction.at.x, b.interaction.seat.z - interaction.at.z))[0];
    if (!pick) return { table, chair: null as FurnitureItem | null, seat: { x: interaction.at.x, z: interaction.at.z - .9 } };
    claimed.add(pick.item.id); return { table, chair: pick.item, seat: { x: pick.interaction.seat.x, z: pick.interaction.seat.z } };
  });
  return { work, free: sits.filter(entry => !claimed.has(entry.item.id)).map(entry => ({ item: entry.item, seat: entry.interaction.seat })) };
}
/**
 * Where the barista hosts a performance: behind the desk the spot stands on (or behind the spot itself), like behind the 1F bar.
 * With a chair at that desk, `seat` is its real seat (the barista sits there only with a seated sheet) and `stand` is just behind its back.
 */
export function presenterSpot(items: readonly FurnitureItem[], spotId: string) {
  const spot = items.find(item => item.id === spotId && !item.stowed);
  if (!spot) return null;
  const desk = (spot.on ? items.find(item => item.id === spot.on && !item.stowed) : undefined) ?? spot;
  const chair = seating(items).work.find(entry => entry.table.id === desk.id)?.chair;
  const at = offered(items, 'work').find(entry => entry.item.id === desk.id)?.interaction.at ?? desk;
  if (!chair) return { stand: { x: at.x, z: at.z - .9 }, seat: null };
  // A chair's `sit` spot is where a resident standee waits; the seated art goes on the seat itself, a little in front of the back.
  const seat = local(chair, 0, seatingProfileFor(chair)?.slots[0]?.z ?? .04);
  return { stand: local(chair, 0, -.65), seat: { x: seat.x, z: seat.z, chair } };
}
export function tableStations(items: readonly FurnitureItem[]) { return offered(items, 'work').map(({ interaction }) => interaction.at); }
export function workSeats(items: readonly FurnitureItem[]) { return seating(items).work.map(entry => entry.seat); }
export function restSpots(items: readonly FurnitureItem[]) {
  return { seats: seating(items).free.filter(entry => entry.item.kind === 'chair').map(entry => entry.seat), rest: { x: 0, z: -.9 } };
}
export function barSpots(items: readonly FurnitureItem[] = defaultFurniture) {
  const serve = offered(items, 'serve')[0]?.interaction;
  const deliver = offered(items, 'deliver')[0]?.interaction;
  const bar = items.find(item => item.kind === 'bar' && !item.stowed) ?? defaultFurniture.find(item => item.kind === 'bar')!;
  const dynamic = collectionBarLayouts[bar.variant];
  const surface = deliver?.surface ?? [];
  const xs = surface.map(point => point.x), zs = surface.map(point => point.z);
  return {
    barista: serve?.spot ?? { x: bar.x - .75, z: bar.z - .95 },
    counter: { x: dynamic ? (Math.min(...xs) + Math.max(...xs)) / 2 : bar.x, z: dynamic ? (Math.min(...zs) + Math.max(...zs)) / 2 : bar.z, halfX: dynamic ? (Math.max(...xs) - Math.min(...xs)) / 2 + .2 : 2.15, halfZ: dynamic ? (Math.max(...zs) - Math.min(...zs)) / 2 + .2 : .4, height: dynamic ? surface[0].y - .08 : 1.05, spot: deliver?.spot ?? { x: bar.x + .05, z: bar.z + .95 }, look: deliver?.look ?? { x: bar.x + .05, z: bar.z } },
    surface: deliver?.surface ?? [],
  };
}


export { interactionsOf, offered, pieces, };
