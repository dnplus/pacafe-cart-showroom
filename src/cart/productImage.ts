import { ownerFetch } from '../owner';

export type ImageLoader = (url: string) => Promise<ImageBitmap | null>;

const bitmaps = new Map<string, Promise<ImageBitmap | null>>();

function remember(key: string, load: () => Promise<ImageBitmap | null>) {
  let entry = bitmaps.get(key);
  if (!entry) {
    entry = load().catch(() => null);
    bitmaps.set(key, entry);
    void entry.then(bitmap => { if (!bitmap) bitmaps.delete(key); });
  }
  return entry;
}

async function decode(response: Response) {
  if (!response.ok) return null;
  return createImageBitmap(await response.blob());
}

/** The owner's room: the worker's image route with the owner key. Pictures are kept for a day by the browser's own cache. */
export const ownerImageLoader: ImageLoader = url =>
  remember(`owner|${url}`, async () => decode(await ownerFetch(`/api/image?u=${encodeURIComponent(url)}`, { cache: 'default' })));

export const visitorImageLoader = (slug: string): ImageLoader => url =>
  remember(`${slug}|${url}`, async () => decode(await fetch(`/api/image?s=${encodeURIComponent(slug)}&u=${encodeURIComponent(url)}`)));
