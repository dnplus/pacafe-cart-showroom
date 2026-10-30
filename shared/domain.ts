/** The one character this room ships art for: an open-source figure behind the counter (see THIRD_PARTY.md). */
export const characters = ['clerk'] as const;
export type Character = typeof characters[number];
export type Principal = { id: string; label: string; source: 'local-fixture' | 'verified-jwt' | 'social-login' | 'paired-agent'; house?: string; houseOwner?: boolean; oauthGrantId?: string; connectionEstablishedAt?: number };
export interface BaristaAppearance { portrait?: { key: string; type: string }; standee?: { key: string }; sheet?: { key: string }; locomotion?: { key: string }; seated?: { key: string } }
