import { roomFurnitureCatalog } from '../../../shared/room-settings';
import { collectionSpec } from './fixtures';
import { collectionPieces } from './collections';
import { espressoMachine, grinder } from './appliances';
import { bar } from './bar';
import { chair } from './chair';
import { crate, plant, rug, signboard, stool } from './small';
import { deskLamp, potPlant, countertop } from './surface';
import { table } from './table';
import { beanShelf, cafeSign, door, lamp, menuBoard, noticeBoard, workBoard } from './wall';
import type { Interaction, Item, PieceKind, PieceSpec } from './types';

export * from './types';
const basePieces: Record<PieceKind, PieceSpec> = { ...collectionPieces, table, chair, stool, plant, signboard, crate, rug, bar, workBoard, menuBoard, cafeSign, beanShelf, lamp, noticeBoard, door, deskLamp, potPlant, countertop, espressoMachine, grinder };

export const pieces = Object.fromEntries(Object.entries(basePieces).map(([kind, spec]): [string, PieceSpec] => [kind, { ...spec, variants: roomFurnitureCatalog[kind as PieceKind].variants }])) as Record<PieceKind, PieceSpec>;
export const specOf = (item: Item) => collectionSpec(item, pieces[item.kind]);

export function interactionsOf<T extends Interaction['type']>(item: Item, ...types: T[]): Extract<Interaction, { type: T }>[] {
  const all = specOf(item).interactions(item);
  return (types.length ? all.filter(entry => (types as string[]).includes(entry.type)) : all) as Extract<Interaction, { type: T }>[];
}
export function offered<T extends Interaction['type']>(items: readonly Item[], type: T) {
  return items.filter(item => !item.stowed).flatMap(item => interactionsOf(item, type).map(interaction => ({ item, interaction })));
}
