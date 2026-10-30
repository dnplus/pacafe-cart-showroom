// The one place the cafe floor's size lives. The back wall (−z) and left wall (−x) never move;
// the room only grows toward its open front (+z) and right (+x), so saved layouts keep their place against the walls.
interface RoomRect { minX: number; maxX: number; minZ: number; maxZ: number }

const round = (value: number) => Math.round(value * 1000) / 1000;
export const insetRoomRect = (rect: RoomRect, x: number, z = x): RoomRect => ({ minX: round(rect.minX + x), maxX: round(rect.maxX - x), minZ: round(rect.minZ + z), maxZ: round(rect.maxZ - z) });

export const roomFloor: RoomRect = { minX: -6.9, maxX: 6.9, minZ: -5.4, maxZ: 8.4 };
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
// Floor-standing furniture keeps its footprint inside this edge.
export const placementEdge = insetRoomRect(roomFloor, .35);
// Residents walk here: the floor less a resident's reach, on the .25 nav grid, so a staircase flush against an edge keeps both landings walkable.
export const walkableArea = insetRoomRect(roomFloor, .9);
export const insideWalkable = (point: { x: number; z: number }) => point.x >= walkableArea.minX && point.x <= walkableArea.maxX && point.z >= walkableArea.minZ && point.z <= walkableArea.maxZ;
// Where the owner may drop a resident they picked up: inside the floor, clear of the back and left walls.
export const residentDropArea: RoomRect = { minX: round(roomFloor.minX + .7), maxX: round(roomFloor.maxX - .7), minZ: round(roomFloor.minZ + .8), maxZ: round(roomFloor.maxZ - .5) };
export const clampToRect = (point: { x: number; z: number }, rect: RoomRect) => ({ x: Math.max(rect.minX, Math.min(rect.maxX, point.x)), z: Math.max(rect.minZ, Math.min(rect.maxZ, point.z)) });
