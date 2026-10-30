/** The clerks the owner can pick from; art and labels live in src/room/residentArt.ts, sources in THIRD_PARTY.md. */
export const characters = ['clerk', 'clerk-mint', 'apron', 'cap'] as const;
export type Character = typeof characters[number];
export type Principal = { id: string; label: string; source: 'local-fixture' | 'verified-jwt' | 'social-login' | 'paired-agent'; house?: string; houseOwner?: boolean; oauthGrantId?: string; connectionEstablishedAt?: number };
export interface BaristaAppearance { portrait?: { key: string; type: string }; standee?: { key: string }; sheet?: { key: string }; locomotion?: { key: string }; seated?: { key: string } }
