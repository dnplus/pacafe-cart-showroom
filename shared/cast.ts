import { z } from 'zod';
import { characters } from './domain';

export const DEFAULT_CHARACTER = 'muse' satisfies typeof characters[number];
/** The Durable Object key of the owner's cast. Only the owner's `/api/cast` reads it; `/s/<slug>` never does. */
export const CAST_KEY = 'cast';

/** What stands in the owner's spot at the room's centre: a stand-in figure, or a sprite Muse Image drew from the owner's photo. */
export const ownerSpriteSchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('placeholder') }),
  z.strictObject({ kind: z.literal('generated'), key: z.string().regex(/^owner\/sprite-[0-9a-f-]{36}\.png$/), generatedAt: z.iso.datetime(), model: z.string().min(1) }),
]);

/** The stored record; the owner has chosen nothing until the first PUT, so every field has a default. */
/** Picks stored before Muse took the counter named the Kenney figures; they stand as Muse now. */
const retired = new Set(['clerk', 'clerk-mint']);
const storedCharacter = z.preprocess(value => typeof value === 'string' && retired.has(value) ? DEFAULT_CHARACTER : value, z.enum(characters));
export const castSchema = z.strictObject({ character: storedCharacter.default(DEFAULT_CHARACTER), owner: ownerSpriteSchema.default({ kind: 'placeholder' }) });
export type Cast = z.output<typeof castSchema>;
/** The owner's PUT body. */
export const castUpdateSchema = z.strictObject({ character: z.enum(characters) });

/** Whether the server can ask Muse Image for a sprite; without its secrets the owner is told what to set. */
export const spriteGenerationSchema = z.discriminatedUnion('available', [
  z.strictObject({ available: z.literal(true) }),
  z.strictObject({ available: z.literal(false), reason: z.literal('needs_meta_api_key') }),
]);

/** `GET /api/cast`: the cast, the name for the owner's nameplate, and whether the sprite button works. */
export const castViewSchema = castSchema.extend({ nickname: z.string(), spriteGeneration: spriteGenerationSchema });
export type CastView = z.output<typeof castViewSchema>;

/** The owner's photo: JPEG or PNG, at most this big. It is sent to the model and never stored. */
export const MAX_PHOTO_BYTES = 2 * 1024 * 1024;
export const photoTypes = ['image/jpeg', 'image/png'] as const;
/** The type a file really is, read from its first bytes; what the browser or the sender claims is not trusted. */
export function sniffPhotoType(bytes: Uint8Array): typeof photoTypes[number] | null {
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'image/jpeg';
  if ([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a].every((byte, i) => bytes[i] === byte)) return 'image/png';
  return null;
}
