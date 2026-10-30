import { interactionsOf, offered, pieces, type Item, type PieceKind } from './pieces';
import { defaultFurniture } from '../../shared/starter-furniture';

export type FurnitureKind = PieceKind;
export type FurnitureItem = Item;

export { defaultFurniture };

/** Where the barista serves from, the counter's box, and the spot on its top the register stands on. */
export function barSpots(items: readonly FurnitureItem[] = defaultFurniture) {
  const serve = offered(items, 'serve')[0]?.interaction;
  const bar = items.find(item => item.kind === 'bar' && !item.stowed) ?? defaultFurniture.find(item => item.kind === 'bar')!;
  const top = pieces.bar.surfaces?.(bar)[0];
  return {
    barista: serve?.spot ?? { x: bar.x - .75, z: bar.z - .95 },
    counter: { x: bar.x, z: bar.z, halfX: 2.15, halfZ: .4, height: 1.05 },
    register: { x: top?.x ?? bar.x + 1.6, y: top?.y ?? 1.13, z: top?.z ?? bar.z - .12, turn: bar.turn },
  };
}

export { interactionsOf, offered, pieces };
