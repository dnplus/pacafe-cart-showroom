import { useCallback, useEffect, useState } from 'react';
import { castViewSchema, MAX_PHOTO_BYTES, type CastView } from '../../shared/cast';
import type { Character } from '../../shared/domain';
import type { TextKey } from '../i18n/messages';
import { ownerFetch } from '../owner';

class Refused extends Error { constructor(readonly status: number) { super(`/api/cast answered ${status}`); } }
async function answer(response: Response) {
  if (!response.ok) throw new Refused(response.status);
  return castViewSchema.parse(await response.json());
}
const problemOf = (error: unknown): TextKey => !(error instanceof Refused) ? 'Could not save. Try again.'
  : error.status === 413 ? 'That photo is over 2 MB.'
  : error.status === 400 ? 'Use a JPEG or PNG photo and tick the box.'
  : error.status === 502 ? 'Muse could not draw a sprite this time. Try again.'
  : 'Could not save. Try again.';

export interface CastController {
  /** What the worker has stored; null until the first answer, and for ever when the room is locked. */
  view: CastView | null;
  /** An object URL for the owner's generated sprite, read through the owner-only /media route; null while it loads or when there is none. */
  spriteUrl: string | null;
  busy: boolean;
  problem: TextKey | null;
  choose(character: Character): Promise<void>;
  generate(photo: File): Promise<void>;
  /** Back to the placeholder figure; the worker deletes the sprite. */
  reset(): Promise<void>;
}

/** The owner's cast, read once the room is open to the owner and again whenever `refreshOn` changes (the nickname on the nameplate lives in the share settings). */
export function useCast(unlocked: boolean, refreshOn: unknown): CastController {
  const [view, setView] = useState<CastView | null>(null);
  const [spriteUrl, setSpriteUrl] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<TextKey | null>(null);

  useEffect(() => {
    if (!unlocked) return;
    let live = true;
    ownerFetch('/api/cast').then(answer).then(next => { if (live) setView(next); }, error => console.warn(error));
    return () => { live = false; };
  }, [unlocked, refreshOn]);

  const key = view?.owner.kind === 'generated' ? view.owner.key : null;
  useEffect(() => {
    if (!key) { setSpriteUrl(null); return; }
    let live = true, url: string | undefined;
    ownerFetch(`/media/${key}`).then(response => response.ok ? response.blob() : Promise.reject(new Refused(response.status))).then(blob => {
      if (!live) return;
      url = URL.createObjectURL(blob); setSpriteUrl(url);
    }, error => console.warn(error));
    return () => { live = false; if (url) URL.revokeObjectURL(url); };
  }, [key]);

  const run = useCallback(async (request: () => Promise<Response>) => {
    setBusy(true); setProblem(null);
    try { setView(await answer(await request())); } catch (error) { console.warn(error); setProblem(problemOf(error)); } finally { setBusy(false); }
  }, []);
  return {
    view, spriteUrl, busy, problem,
    choose: character => run(() => ownerFetch('/api/cast', { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ character }) })),
    generate: photo => {
      if (photo.size > MAX_PHOTO_BYTES) { setProblem('That photo is over 2 MB.'); return Promise.resolve(); }
      const body = new FormData(); body.set('photo', photo); body.set('consent', 'true');
      return run(() => ownerFetch('/api/cast/owner-sprite', { method: 'POST', body }));
    },
    reset: () => run(() => ownerFetch('/api/cast/owner-sprite', { method: 'DELETE' })),
  };
}
