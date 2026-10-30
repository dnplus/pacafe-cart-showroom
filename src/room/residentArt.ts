import type { Character } from '../../shared/domain';

/** `height` is how tall the standee stands in the room, in metres; the robot is wider than it is tall. */
interface ResidentArt { label: string; portrait: string; standee: string; height: number }

/** Rendered from Kenney's CC0 platformer character by scripts/render-character.mjs. */
export const residentArt: Readonly<Record<Character, ResidentArt>> = {
  clerk: { label: '店員', portrait: '/art/characters/clerk-portrait.png', standee: '/art/characters/clerk-standee.png', height: 1.55 },
};
