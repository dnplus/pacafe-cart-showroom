import type { Character } from '../../shared/domain';

interface ResidentArt { label: string; portrait: string; standee: string }

/** Rendered from Kenney's CC0 platformer character by scripts/render-character.mjs. */
export const residentArt: Readonly<Record<Character, ResidentArt>> = {
  clerk: { label: '店員', portrait: '/art/characters/clerk-portrait.png', standee: '/art/characters/clerk-standee.png' },
};
