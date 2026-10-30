import { roomFurnitureCatalog } from '../../../shared/room-settings';
import { bar } from './bar';
import { plant, rug } from './small';
import { beanShelf } from './wall';
import type { Interaction, Item, PieceKind, PieceSpec } from './types';

export * from './types';
const basePieces: Record<PieceKind, PieceSpec> = { plant, rug, bar, beanShelf };

export const pieces = Object.fromEntries(Object.entries(basePieces).map(([kind, spec]): [string, PieceSpec] => [kind, { ...spec, variants: roomFurnitureCatalog[kind as PieceKind].variants }])) as Record<PieceKind, PieceSpec>;

export function interactionsOf<T extends Interaction['type']>(item: Item, ...types: T[]): Extract<Interaction, { type: T }>[] {
  const all = pieces[item.kind].interactions(item);
  return (types.length ? all.filter(entry => (types as string[]).includes(entry.type)) : all) as Extract<Interaction, { type: T }>[];
}
export function offered<T extends Interaction['type']>(items: readonly Item[], type: T) {
  return items.filter(item => !item.stowed).flatMap(item => interactionsOf(item, type).map(interaction => ({ item, interaction })));
}
