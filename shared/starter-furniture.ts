import type { RoomFurnitureItem } from './room-settings.ts';

export const defaultFurniture: readonly RoomFurnitureItem[] = [
  { id: 'bar-1', kind: 'bar', variant: 'walnut', x: 2.45, z: -2.9, turn: 0 },
  { id: 'shelf-1', kind: 'beanShelf', variant: 'jars', x: 2.8, z: 0, turn: 0, wall: 'back' },
  { id: 'plant-1', kind: 'plant', variant: 'leafy', x: 5.7, z: -4.5, turn: 0, size: 1 },
  { id: 'rug-1', kind: 'rug', variant: 'round', x: 2.45, z: .6, turn: 0 },
];
