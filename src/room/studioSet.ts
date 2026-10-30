import { STUDIO_SET_SPOT, type StudioSet, type StudioSetPreset } from '../../shared/studio';

/**
 * Each studio set measured in its own frame: the desk a script's `spot` camera frames, and where the host sits (or, at
 * a lectern, stands). `seat` is the seat's height above the floor.
 */
const sets: Record<StudioSetPreset, { asset: string; desk: { x: number; z: number }; host: { x: number; z: number; seat: number | null } }> = {
  presenter: { asset: '/studio/showroom-set.glb', desk: { x: 0, z: 0 }, host: { x: 0, z: -.68, seat: .77 } },
};
export const studioSetAsset = (preset: StudioSetPreset) => sets[preset].asset;

/** The presenter set stands left of the counter in the showroom, the owner's and a visitor's alike; scripts/generate-studio-set.mjs builds its model. */
export const showroomStudioSet: StudioSet = { preset: 'presenter', x: -2.6, z: -3.3 };

/** The set's desk (or lectern): what a script's `spot` camera frames while the set is up. */
export const studioSetDesk = (set: StudioSet) => ({ x: set.x + sets[set.preset].desk.x, z: set.z + sets[set.preset].desk.z });

/** Where the barista hosts from the set: the chair's seat (with its height above the floor), or the spot behind the lectern. */
export function hostPlace(spot: string, set: StudioSet | null | undefined) {
  if (spot !== STUDIO_SET_SPOT || !set) return null;
  const host = sets[set.preset].host, at = { x: set.x + host.x, z: set.z + host.z };
  return host.seat === null ? { stand: at, seat: null } : { stand: { x: at.x, z: at.z - .45 }, seat: { ...at, height: host.seat } };
}
