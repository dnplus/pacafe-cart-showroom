import { floorOf, type FloorId } from '../../shared/floors';
import { insetRoomRect, roomFloor } from '../../shared/room-dimensions';
import { isStair, openingFootprints } from '../../shared/stairs';
import { STUDIO_SET_SPOT, type StudioSet, type StudioSetPreset } from '../../shared/studio';
import { seatingProfileFor } from '../../shared/seating-profiles';
import { doorway, offered, piecesOf, presenterSpot, seating, type Footprint, type FurnitureItem } from './furniture';
import { local } from './pieces';

/**
 * The three studio sets from #582's first version (public/creator/*.glb), measured in the set's own frame: the floor under
 * each prop, and where the host sits (or, at the lectern, stands). `seat` is the seat's height above the floor.
 */
const sets: Record<StudioSetPreset, { footprints: readonly [number, number, number, number][]; desk: { x: number; z: number }; host: { x: number; z: number; seat: number | null } }> = {
  presenter: {
    footprints: [[-1.72, 1.08, .38, .4], [0, -.95, .53, .35], [0, 0, 1.25, .45], [1.66, -1.29, .34, .34], [1.98, .75, .37, .38], [-1.6, -1.29, .85, .35]],
    desk: { x: 0, z: 0 }, host: { x: 0, z: -.68, seat: .77 },
  },
  gaming: {
    footprints: [[0, -1.29, .59, .48], [0, 0, 1.3, .53], [-2.05, -.81, .49, .32], [1.76, -1.31, .32, .39], [1.8, -.04, .35, .35]],
    desk: { x: 0, z: 0 }, host: { x: 0, z: -1, seat: .79 },
  },
  teaching: {
    footprints: [[-1.42, -1.42, .73, .31], [1.79, 1.41, .39, .38], [-1.25, .55, .62, .43], [-1.25, -.13, .35, .36], [-2.44, 1.19, .33, .39], [1.7, -.58, .64, .34], [.6, -1.6, .85, .34]],
    desk: { x: -1.25, z: .55 }, host: { x: -1.25, z: .08, seat: null },
  },
};
export const studioSetAsset = (preset: StudioSetPreset) => `/creator/${preset}.glb`;

export function studioSetFootprints(set: StudioSet): Footprint[] {
  return sets[set.preset].footprints.map(([x, z, rx, rz]) => ({ x: set.x + x, z: set.z + z, rx, rz, shape: 'rect' as const }));
}
/** The set's desk (or lectern): what a script's `spot` camera frames while the set is up. */
export const studioSetDesk = (set: StudioSet) => ({ x: set.x + sets[set.preset].desk.x, z: set.z + sets[set.preset].desk.z });
/** Where the host is in the room: a chair's seat (with its height above the floor), or the spot behind the lectern. */
function studioSetHost(set: StudioSet) {
  const host = sets[set.preset].host, at = { x: set.x + host.x, z: set.z + host.z };
  return host.seat === null ? { stand: at, seat: null } : { stand: { x: at.x, z: at.z - .45 }, seat: { ...at, height: host.seat } };
}

const box = (f: Footprint) => f.points
  ? { minX: Math.min(...f.points.map(p => p.x)), maxX: Math.max(...f.points.map(p => p.x)), minZ: Math.min(...f.points.map(p => p.z)), maxZ: Math.max(...f.points.map(p => p.z)) }
  : { minX: f.x - f.rx, maxX: f.x + f.rx, minZ: f.z - f.rz, maxZ: f.z + f.rz };
const touches = (a: Footprint, b: Footprint, margin: number) => { const p = box(a), q = box(b); return p.minX < q.maxX + margin && q.minX < p.maxX + margin && p.minZ < q.maxZ + margin && q.minZ < p.maxZ + margin; };

/** The editor's corner: the laptop, the table it stands on and that table's work chair. The set never covers them. */
function station(items: readonly FurnitureItem[], keyId: string) {
  const key = items.find(item => item.id === keyId && !item.stowed);
  if (!key) return [];
  const table = key.on ? items.find(item => item.id === key.on && !item.stowed) : undefined;
  const chair = table ? seating(items).work.find(entry => entry.table.id === table.id)?.chair : undefined;
  return [key, table, chair].filter((item): item is FurnitureItem => Boolean(item));
}

/**
 * Where a new set goes on the laptop's floor: near the back wall and the middle, inside the floor, clear of the editor's
 * corner, the stair openings and the doorway. Furniture it lands on is covered while the set is up, never moved.
 */
export function placeStudioSet(items: readonly FurnitureItem[], floorId: FloorId, keyId: string, preset: StudioSetPreset): StudioSet {
  const onFloor = items.filter(item => !item.stowed && floorOf(item) === floorId);
  const keep = [...station(onFloor, keyId).flatMap(piecesOf), ...openingFootprints(items, floorId)];
  const door = doorway(onFloor).inside, inside = insetRoomRect(roomFloor, .4);
  const candidates = [-3.4, -2.4, -1.4, -.4, .6, 1.6, 2.6].flatMap(z => [0, -1.5, 1.5, -3, 3, -4.5, 4.5].map(x => ({ x, z })))
    .sort((a, b) => Math.hypot(a.x, a.z + 3.4) - Math.hypot(b.x, b.z + 3.4));
  const fits = (at: { x: number; z: number }) => studioSetFootprints({ preset, ...at }).every(f => {
    const b = box(f);
    return b.minX >= inside.minX && b.maxX <= inside.maxX && b.minZ >= inside.minZ && b.maxZ <= inside.maxZ
      && !keep.some(other => touches(f, other, .5)) && Math.hypot(Math.max(b.minX - door.x, 0, door.x - b.maxX), Math.max(b.minZ - door.z, 0, door.z - b.maxZ)) > 1;
  });
  const at = candidates.find(fits) ?? candidates[0];
  return { preset, ...at };
}

/** The floor as the set shows it: furniture under the set is covered (and what stands on it), the editor's corner and stairs stay. */
export function studioRoomItems(items: readonly FurnitureItem[], floorId: FloorId, keyId: string, set: StudioSet | null | undefined): FurnitureItem[] {
  if (!set) return [...items];
  const footprints = studioSetFootprints(set), keep = new Set(station(items.filter(item => floorOf(item) === floorId), keyId).map(item => item.id));
  const covered = new Set(items.filter(item => !item.stowed && floorOf(item) === floorId && !keep.has(item.id) && !isStair(item)
    && piecesOf(item).some(f => footprints.some(other => touches(f, other, .05)))).map(item => item.id));
  return items.filter(item => !covered.has(item.id) && !(item.on && covered.has(item.on)));
}

/** Pieces the barista can be asked to host from: anything with a seat. */
export const hostSeats = (items: readonly FurnitureItem[]) => offered(items.filter(item => !item.stowed), 'sit').map(entry => entry.item.id);

/**
 * Where the barista hosts: the set's C position, a chair the barista picked, or (without a set) behind the script's spot.
 * `seat.height` is above the floor; a chair's comes from its seating profile.
 */
export function hostPlace(items: readonly FurnitureItem[], spot: string, set: StudioSet | null | undefined) {
  if (spot === STUDIO_SET_SPOT) return set ? studioSetHost(set) : null;
  const chair = items.find(item => item.id === spot && !item.stowed);
  if (chair && hostSeats(items).includes(chair.id)) {
    const profile = seatingProfileFor(chair)?.slots[0], seat = local(chair, 0, profile?.z ?? .04);
    return { stand: local(chair, 0, -.65), seat: { x: seat.x, z: seat.z, height: profile?.height ?? .3625 } };
  }
  const place = presenterSpot(items, spot);
  if (!place) return null;
  return { stand: place.stand, seat: place.seat ? { x: place.seat.x, z: place.seat.z, height: seatingProfileFor(place.seat.chair)?.slots[0]?.height ?? .3625 } : null };
}
