import type { Character } from '../../shared/domain';
import type { TextKey } from '../i18n/messages';
import { apronClerkArt, capClerkArt } from './characterArt';

/** `height` is how tall the standee stands in the room, in metres; the robots are wider than they are tall. */
interface ResidentArt { label: TextKey; portrait: string; standee: string; height: number }

/** The two robots are Kenney's CC0 platformer character rendered by scripts/render-character.mjs; the other two are drawn in code (characterArt.ts). */
export const residentArt: Readonly<Record<Character, ResidentArt>> = {
  clerk: { label: 'Clerk', portrait: '/art/characters/clerk-portrait.png', standee: '/art/characters/clerk-standee.png', height: 1.55 },
  'clerk-mint': { label: 'Mint clerk', portrait: '/art/characters/clerk-mint-portrait.png', standee: '/art/characters/clerk-mint-standee.png', height: 1.55 },
  apron: { label: 'Apron clerk', ...apronClerkArt, height: 1.75 },
  cap: { label: 'Cap clerk', ...capClerkArt, height: 1.75 },
};
