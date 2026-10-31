import { z } from 'zod';
import { metaBase } from '../shared/meta';
import type { Env } from './env';

export const SPRITE_MODEL = 'muse-image-1.0';
/**
 * Where the reference photo goes in the request. The Meta Images API page was not checked for an image-input field;
 * `image` (a data URL) is what OpenAI-compatible image endpoints use, so this is a guess until a real call confirms it.
 */
export const REFERENCE_IMAGE_FIELD = 'image';
/** The fixed prompt. It names no product or brand, and the photo is the only thing the owner contributes. */
const SPRITE_PROMPT = 'A full-body chibi standee illustration of the person in the reference photo: a cute neutral cartoon figure with a big head and small body, standing straight and facing the camera with arms relaxed at the sides, the whole body visible from head to shoes. Simple clean shapes, soft flat colours, a thin outline. Plain transparent background, no text, no logo, no props, no ground shadow.';

const MAX_SPRITE_BYTES = 8 * 1024 * 1024;
const TIMEOUT_MS = 100_000;
const pngSignature = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const answerSchema = z.object({ data: z.array(z.object({ b64_json: z.string().optional(), url: z.string().optional() })).min(1) });

/** What the model sent back is not a usable sprite. The message is kept off the wire, so it can never carry a key. */
export class SpriteError extends Error {}

/**
 * The request body for one sprite. `enable_image_search: false` keeps the model from looking the person up on the web:
 * the photo is the owner's own and is the only reference it may use.
 */
const spriteRequest = (photo: { bytes: Uint8Array; type: string }) => ({
  model: SPRITE_MODEL,
  prompt: SPRITE_PROMPT,
  n: 1,
  size: '1024x1024',
  response_format: 'b64_json',
  enable_image_search: false,
  [REFERENCE_IMAGE_FIELD]: `data:${photo.type};base64,${toBase64(photo.bytes)}`,
});

const toBase64 = (bytes: Uint8Array) => { let text = ''; for (let at = 0; at < bytes.length; at += 0x8000) text += String.fromCharCode(...bytes.subarray(at, at + 0x8000)); return btoa(text); };
const fromBase64 = (text: string) => Uint8Array.from(atob(text), char => char.charCodeAt(0));
const isPng = (bytes: Uint8Array) => pngSignature.every((byte, i) => bytes[i] === byte);

/** Asks Muse Image for one PNG sprite; throws SpriteError for any answer that is not one. */
export async function requestSprite(env: Env & { META_API_KEY: string; META_API_BASE_URL: string }, photo: { bytes: Uint8Array; type: string }): Promise<Uint8Array> {
  let answer: Response;
  try {
    answer = await fetch(`${metaBase(env.META_API_BASE_URL)}/images/generations`, {
      method: 'POST', headers: { authorization: `Bearer ${env.META_API_KEY}`, 'content-type': 'application/json' },
      body: JSON.stringify(spriteRequest(photo)), signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch { throw new SpriteError('unreachable'); }
  if (!answer.ok) throw new SpriteError(`status ${answer.status}`);
  const parsed = answerSchema.safeParse(await answer.json().catch(() => null));
  if (!parsed.success) throw new SpriteError('unreadable answer');
  const { b64_json, url } = parsed.data.data[0];
  let bytes: Uint8Array;
  try {
    if (b64_json) bytes = fromBase64(b64_json);
    else if (url?.startsWith('https://')) bytes = new Uint8Array(await (await fetch(url, { signal: AbortSignal.timeout(TIMEOUT_MS) })).arrayBuffer());
    else throw new SpriteError('no image');
  } catch (error) { throw error instanceof SpriteError ? error : new SpriteError('image unreadable'); }
  if (bytes.length > MAX_SPRITE_BYTES || !isPng(bytes)) throw new SpriteError('not a png');
  return bytes;
}
