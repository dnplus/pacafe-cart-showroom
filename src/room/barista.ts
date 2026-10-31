import type { BaristaAppearance, Character } from '../../shared/domain';
import type { TextKey } from '../i18n/messages';
import { ownerArt, residentArt } from './residentArt';
import { ownerSilhouette, residentSilhouette } from './silhouette';

interface BaristaArt { label: TextKey; portrait: string; standee: string; height?: number; sheet?: string }
export const baristaArt: Readonly<Record<Character, BaristaArt>> = residentArt;

/** One full-body image a figure can wear. `sheet` marks a four-direction walk sheet; `height` is the figure's height in metres. */
export interface Body { src: string; height?: number; sheet?: boolean }

/** The full-body images the barista can wear, best first: the walk sheet, the standee, and the plain silhouette when none loads. */
export function baristaBodies(character: Character, appearance?: BaristaAppearance): Body[] {
  const art = baristaArt[character];
  return [
    ...(appearance?.standee ? [{ src: `/media/${appearance.standee.key}` }] : []),
    ...(art.sheet ? [{ src: art.sheet, height: art.height, sheet: true }] : []),
    { src: art.standee, height: art.height },
    { src: residentSilhouette },
  ];
}

const OWNER_HEIGHT = 2;
/** The owner's figure: the sprite drawn from their photo when there is one, else the generated shop owner, else the stand-in silhouette. */
export const ownerBodies = (sprite: string | null): Body[] => [
  ...(sprite ? [{ src: sprite, height: OWNER_HEIGHT }] : []),
  { src: ownerArt.sheet, height: ownerArt.height, sheet: true },
  { src: ownerArt.standee, height: ownerArt.height },
  { src: ownerSilhouette, height: OWNER_HEIGHT },
];
