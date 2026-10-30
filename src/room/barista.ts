import type { BaristaAppearance, Character } from '../../shared/domain';
import { residentArt } from './residentArt';
import { residentSilhouette } from './silhouette';

interface BaristaArt { label: string; portrait: string; standee: string }
export const baristaArt: Readonly<Record<Character, BaristaArt>> = residentArt;

/** The full-body images the barista can wear, best first; the plain silhouette stands in when none loads. */
export function baristaBodies(character: Character, appearance?: BaristaAppearance): string[] {
  return [...(appearance?.standee ? [`/media/${appearance.standee.key}`] : []), baristaArt[character].standee, residentSilhouette];
}
