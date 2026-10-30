// The one place the cafe floor's size lives. The back wall (−z) and left wall (−x) never move;
// the room only grows toward its open front (+z) and right (+x), so saved layouts keep their place against the walls.
interface RoomRect { minX: number; maxX: number; minZ: number; maxZ: number }

const round = (value: number) => Math.round(value * 1000) / 1000;

// The showroom is the shop corner of pa-cafe's floor: the counter and shelf on the right, the studio set on the left.
export const roomFloor: RoomRect = { minX: -5.2, maxX: 5.4, minZ: -5.4, maxZ: 1.6 };
/** The planks' top face: floor-standing furniture, the studio set and a seated host's seat heights start here. */
export const floorTop = .2225;
export const roomSize = {
  width: round(roomFloor.maxX - roomFloor.minX), depth: round(roomFloor.maxZ - roomFloor.minZ),
  centreX: round((roomFloor.minX + roomFloor.maxX) / 2), centreZ: round((roomFloor.minZ + roomFloor.maxZ) / 2),
};
// `z` / `x` is the inner face; min/max is the stretch a hung piece's centre line may use.
export const roomWalls = {
  back: { z: round(roomFloor.minZ + .14), min: round(roomFloor.minX + .5), max: round(roomFloor.maxX - .5) },
  left: { x: round(roomFloor.minX + .19), min: round(roomFloor.minZ + .4), max: round(roomFloor.maxZ - .4) },
  height: 4, thickness: .18, top: 4.17,
} as const;
