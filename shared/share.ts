import { z } from 'zod';

// S3 extends this with what a visitor sees; sharing starts disabled.
export const shareSettingsSchema = z.strictObject({ slug: z.string().regex(/^[A-Za-z0-9_-]{22}$/), enabled: z.boolean() });
export type ShareSettings = z.infer<typeof shareSettingsSchema>;

/** 16 random bytes as unpadded base64url: 22 characters nobody can guess from the showroom's address. */
export function newShareSettings(): ShareSettings {
  const slug = btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(16)))).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');
  return { slug, enabled: false };
}

export const shareUrl = (origin: string, slug: string) => `${origin}/s/${slug}`;
