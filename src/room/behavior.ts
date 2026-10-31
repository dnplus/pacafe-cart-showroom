export type Facing = 'S' | 'SW' | 'W' | 'NW' | 'N' | 'NE' | 'E' | 'SE';
export interface Vec { x: number; z: number }
export const compass = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'] as const satisfies readonly Facing[];

/** Which of the eight compass facings a step of (dx, dz) shows on screen, for a camera looking along `view` (from the scene toward the viewer). */
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
