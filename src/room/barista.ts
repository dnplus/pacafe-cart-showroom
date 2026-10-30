import type { BaristaAppearance, Character } from '../../shared/domain';
import { residentArt } from './residentArt';
import { residentSilhouette } from './silhouette';

interface BaristaArt { label: string; portrait: string; standee: string; height?: number }
export const baristaArt: Readonly<Record<Character, BaristaArt>> = residentArt;

/** The full-body images the barista can wear, best first; the plain silhouette stands in when none loads. */
export function baristaBodies(character: Character, appearance?: BaristaAppearance): { src: string; height?: number }[] {
  const art = baristaArt[character];
  return [...(appearance?.standee ? [{ src: `/media/${appearance.standee.key}` }] : []), { src: art.standee, height: art.height }, { src: residentSilhouette }];
}
