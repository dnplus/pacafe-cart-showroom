import type { Character } from '../../shared/domain';
import { apronClerkArt, capClerkArt } from './characterArt';

/** `height` is how tall the standee stands in the room, in metres; the robots are wider than they are tall. */
interface ResidentArt { label: string; portrait: string; standee: string; height: number }

/** The two robots are Kenney's CC0 platformer character rendered by scripts/render-character.mjs; the other two are drawn in code (characterArt.ts). */
export const residentArt: Readonly<Record<Character, ResidentArt>> = {
  clerk: { label: '店員', portrait: '/art/characters/clerk-portrait.png', standee: '/art/characters/clerk-standee.png', height: 1.55 },
  'clerk-mint': { label: '薄荷店員', portrait: '/art/characters/clerk-mint-portrait.png', standee: '/art/characters/clerk-mint-standee.png', height: 1.55 },
  apron: { label: '圍裙店員', ...apronClerkArt, height: 1.75 },
  cap: { label: '帽子店員', ...capClerkArt, height: 1.75 },
};
