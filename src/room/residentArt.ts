import type { Character } from '../../shared/domain';

interface ResidentArt { label: string; portrait: string; standee: string; sheet: string }

export const residentArt: Readonly<Record<Character, ResidentArt>> = {
  gpt: { label: 'dots', portrait: '/art/residents/defaults/dots-portrait-208.webp', standee: '/art/residents/defaults/dots-fullbody.png', sheet: '/art/residents/defaults/dots-spritesheet.png' },
  grok: { label: 'Grok Bot', portrait: '/art/residents/defaults/grok-bot-portrait-208.webp', standee: '/art/residents/defaults/grok-bot-fullbody.png', sheet: '/art/residents/defaults/grok-bot-spritesheet.png' },
  gemini: { label: 'Muse', portrait: '/art/residents/defaults/muse-portrait-208.webp', standee: '/art/residents/defaults/muse-fullbody.png', sheet: '/art/residents/defaults/muse-spritesheet.png' },
  claude: { label: 'Claude', portrait: '/art/residents/defaults/claude-portrait-208.webp', standee: '/art/residents/defaults/claude-fullbody.png', sheet: '/art/residents/defaults/claude-spritesheet.png' },
};
