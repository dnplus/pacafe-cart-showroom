import type { BaristaAppearance, Character } from '../../shared/domain';
import type { TextKey } from '../i18n/messages';
import { residentArt } from './residentArt';
import { ownerSilhouette, residentSilhouette } from './silhouette';

interface BaristaArt { label: TextKey; portrait: string; standee: string; height?: number }
export const baristaArt: Readonly<Record<Character, BaristaArt>> = residentArt;

/** The full-body images the barista can wear, best first; the plain silhouette stands in when none loads. */
export function baristaBodies(character: Character, appearance?: BaristaAppearance): { src: string; height?: number }[] {
  const art = baristaArt[character];
  return [...(appearance?.standee ? [{ src: `/media/${appearance.standee.key}` }] : []), { src: art.standee, height: art.height }, { src: residentSilhouette }];
}

const OWNER_HEIGHT = 1.7;
/** The owner's standee: the sprite drawn from their photo when there is one, else the stand-in figure. */
export const ownerBodies = (sprite: string | null) => [...(sprite ? [{ src: sprite, height: OWNER_HEIGHT }] : []), { src: ownerSilhouette, height: OWNER_HEIGHT }];
