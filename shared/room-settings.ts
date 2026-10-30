// The showroom's furniture: the counter, the cart shelf behind it, and two pieces of decor. Every one is drawn from code.
export const roomFurnitureCatalog = {
  plant: { variants: ['leafy', 'cactus'], mount: 'floor' },
  rug: { variants: ['star', 'round'], mount: 'floor' },
  bar: { variants: ['walnut', 'oak'], mount: 'floor' },
  beanShelf: { variants: ['jars'], mount: 'wall' },
} as const;
export type RoomFurnitureKind = keyof typeof roomFurnitureCatalog;
export type RoomWall = 'back' | 'left';
export type RoomTurn = 0 | 1 | 2 | 3;
export interface RoomFurnitureItem {
  id: string; kind: RoomFurnitureKind; variant: string; x: number; z: number; turn: RoomTurn;
  size?: number; wall?: RoomWall; stowed?: boolean;
}
