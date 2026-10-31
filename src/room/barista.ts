import type { BaristaAppearance, Character } from '../../shared/domain';
import type { TextKey } from '../i18n/messages';
import { ownerArt, residentArt } from './residentArt';
import { ownerSilhouette, residentSilhouette } from './silhouette';

interface BaristaArt { label: TextKey; portrait: string; standee: string; height?: number; sheet?: string }
export const baristaArt: Readonly<Record<Character, BaristaArt>> = residentArt;

export interface Body { src: string; height?: number; sheet?: boolean }

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
export const ownerBodies = (sprite: string | null): Body[] => [
  ...(sprite ? [{ src: sprite, height: OWNER_HEIGHT }] : []),
  { src: ownerArt.sheet, height: ownerArt.height, sheet: true },
  { src: ownerArt.standee, height: ownerArt.height },
  { src: ownerSilhouette, height: OWNER_HEIGHT },
];
