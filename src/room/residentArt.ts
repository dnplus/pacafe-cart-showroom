import type { Character } from '../../shared/domain';
import type { TextKey } from '../i18n/messages';
import { apronClerkArt, capClerkArt } from './characterArt';

/**
 * `height` is how tall the standee stands in the room, in metres. `sheet` is a 2048x1024 four-direction walk sheet
 * (shared/sprites.ts, format `four`); a clerk without one is a single image that bobs, hops and flips instead of walking its cycle.
 */
interface ResidentArt { label: TextKey; portrait: string; standee: string; height: number; sheet?: string }

/** Muse is PA Cafe's resident art, copied unchanged; the other two are drawn in code (characterArt.ts). */
export const residentArt: Readonly<Record<Character, ResidentArt>> = {
  muse: { label: 'Muse', portrait: '/art/characters/muse-portrait-208.webp', standee: '/art/characters/muse-fullbody.png', sheet: '/art/characters/muse-spritesheet.png', height: 2 },
  apron: { label: 'Apron clerk', ...apronClerkArt, height: 1.75 },
  cap: { label: 'Cap clerk', ...capClerkArt, height: 1.75 },
};

/** The figure for the owner's spot: Codex-generated art (see THIRD_PARTY.md). A photo-drawn sprite replaces it while there is one. */
export const ownerArt = { label: 'Shop owner' as const satisfies TextKey, portrait: '/art/characters/owner-portrait-208.webp', standee: '/art/characters/owner-fullbody.png', sheet: '/art/characters/owner-spritesheet.png', height: 2 };
