import { z } from 'zod';
import type { CartCategory } from './cart.ts';

export const BOXES = ['kraft', 'sky', 'mint', 'blush', 'butter', 'lilac'] as const;
export const TAPES = ['cream', 'red', 'brown', 'blue', 'washi'] as const;
export const FILLERS = ['paper', 'bubble', 'peanuts', 'tissue', 'confetti'] as const;
export const STICKERS = ['star', 'clover', 'cat', 'rainbow', 'moon', 'berry', 'rocket', 'bear'] as const;
export const packagingSchema = z.strictObject({ box: z.enum(BOXES), tape: z.enum(TAPES), filler: z.enum(FILLERS), sticker: z.enum(STICKERS).nullable() });
export type Packaging = z.infer<typeof packagingSchema>;
export type StickerId = typeof STICKERS[number];

export const STICKER_ONE_IN = 4;

/** FNV-1a with a final mix, a stable number per text whose low bits do not follow the last characters. */
const hash = (text: string) => {
  let h = 0x811c9dc5; for (let i = 0; i < text.length; i++) { h ^= text.charCodeAt(i); h = Math.imul(h, 0x01000193); }
  h ^= h >>> 16; h = Math.imul(h, 0x85ebca6b); h ^= h >>> 13; h = Math.imul(h, 0xc2b2ae35); h ^= h >>> 16;
  return h >>> 0;
};
/** Seeds for the three draws; these ones give the five fixture items four box colours, four tapes and two stickers. */
const SEED = { box: '~box1', tape: '~tape3', sticker: '~sticker4' };
const pick = <T,>(list: readonly T[], text: string) => list[hash(text) % list.length];

const FILLER_BY_CATEGORY: Partial<Record<CartCategory, typeof FILLERS[number]>> = { kitchen: 'bubble', home: 'bubble', electronics: 'peanuts', fashion: 'tissue', beauty: 'tissue', books: 'paper', food: 'confetti' };

export function packagingOf(item: { id: string; store: string | null; category: CartCategory | null }): Packaging {
  const shop = item.store?.trim().toLowerCase() || item.category || 'other';
  const sticker = hash(`${item.id}${SEED.sticker}`) % STICKER_ONE_IN === 0 ? pick(STICKERS, `${item.id}~which`) : null;
  return { box: pick(BOXES, `${shop}${SEED.box}`), tape: pick(TAPES, `${shop}${SEED.tape}`), filler: (item.category && FILLER_BY_CATEGORY[item.category]) || pick(FILLERS, `${shop}~filler`), sticker };
}

export type Rarity = 'rare' | 'fine' | 'plain';
export const rarityOf = (pack: Packaging): Rarity => pack.sticker ? 'rare' : pack.tape === 'washi' || pack.filler === 'confetti' ? 'fine' : 'plain';
