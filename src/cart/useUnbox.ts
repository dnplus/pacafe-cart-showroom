import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react';
import type { Cart } from '../../shared/cart';
import { unboxStateSchema } from '../../shared/unbox';
import { ownerFetch } from '../owner';
import { popDuration, shelvedIds, STAGGER_MS, STAGGERED, unboxReducer, type Box } from './unbox';

export const ARRIVE_MS = 520;
const RETRY_MS = 2000;

const reducedMotion = () => typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
const motion = (ms: number) => reducedMotion() ? Math.min(ms, 120) : ms;
const idsOf = (opened: Record<string, string>): ReadonlySet<string> => new Set(Object.keys(opened));

/** `commit` is retried while it throws, and only then is the batch shelved. `recorded` null means nobody has answered yet, so the shelf is never drawn from a guess. */
export function useUnboxFlow(ids: readonly string[] | null, recorded: ReadonlySet<string> | null, commit: (ids: string[], signal: AbortSignal) => Promise<void>) {
  const [boxes, dispatch] = useReducer(unboxReducer, [] as readonly Box[]);
  const [saveFailed, setSaveFailed] = useState(false);
  const [landed, setLanded] = useState<ReadonlySet<string>>(new Set());
  const idsKey = ids?.join('\n') ?? null;

  useEffect(() => {
    if (idsKey !== null && recorded) dispatch({ type: 'sync', ids: idsKey ? idsKey.split('\n') : [], opened: recorded });
  }, [idsKey, recorded]);

  const arriving = boxes.filter(box => box.phase === 'arriving').map(box => box.id).join('|');
  useEffect(() => {
    if (!arriving) return;
    const timers = arriving.split('|').map((id, i) => setTimeout(() => dispatch({ type: 'arrived', id }), motion(ARRIVE_MS + Math.min(i, STAGGERED) * STAGGER_MS)));
    return () => timers.forEach(clearTimeout);
  }, [arriving]);

  // Each opened parcel plays its own reveal, which a later parcel being cut does not interrupt; the write waits for the ones that are done.
  const popping = boxes.filter(box => box.phase === 'opened').map(box => box.id).join('|');
  const reveals = useRef(new Map<string, ReturnType<typeof setTimeout> | undefined>());
  const [finished, setFinished] = useState<ReadonlySet<string>>(new Set());
  // Parcels opened together are a multi-pull: the stage plays them and waits for the person to put them on the shelf (`settle`), so no timer ends them.
  const [held, setHeld] = useState<ReadonlySet<string>>(new Set());
  useEffect(() => {
    const ids = popping ? popping.split('|') : [], fresh = ids.filter(id => !reveals.current.has(id));
    const ms = popDuration(1, reducedMotion());
    if (fresh.length > 1) { for (const id of fresh) reveals.current.set(id, undefined); setHeld(before => new Set([...before, ...fresh])); }
    else for (const id of fresh) reveals.current.set(id, setTimeout(() => setFinished(before => new Set(before).add(id)), ms));
    for (const [id, timer] of reveals.current) if (!ids.includes(id)) { clearTimeout(timer); reveals.current.delete(id); setHeld(before => { const next = new Set(before); next.delete(id); return next; }); }
  }, [popping]);
  useEffect(() => () => reveals.current.forEach(clearTimeout), []);

  const due = popping ? popping.split('|').filter(id => finished.has(id)).join('|') : '';
  const [attempt, setAttempt] = useState(0);
  const save = useRef(commit); save.current = commit;
  useEffect(() => {
    if (!due) return;
    const ids = due.split('|'), controller = new AbortController(); let retry: ReturnType<typeof setTimeout> | undefined;
    (async () => {
      try {
        await save.current(ids, controller.signal);
        setSaveFailed(false); setAttempt(0); setLanded(before => new Set([...before, ...ids]));
        setFinished(before => { const next = new Set(before); ids.forEach(id => next.delete(id)); return next; });
        setHeld(before => { const next = new Set(before); ids.forEach(id => next.delete(id)); return next; });
        dispatch({ type: 'shelved', ids });
      } catch (error) {
        if (controller.signal.aborted) return;
        console.warn(error); setSaveFailed(true);
        retry = setTimeout(() => setAttempt(count => count + 1), RETRY_MS);
      }
    })();
    return () => { controller.abort(); clearTimeout(retry); };
  }, [due, attempt]);

  // A slice changes `boxes` on every pointer move; the room only hears about the shelf when a parcel joins it.
  const shelvedKey = [...shelvedIds(boxes)].join('|');
  const shelved = useMemo(() => new Set(shelvedKey ? shelvedKey.split('|') : []), [shelvedKey]);

  return {
    boxes, shelved, landed, held, ready: recorded !== null, saveFailed,
    settle: useCallback((ids: readonly string[]) => setFinished(before => new Set([...before, ...ids])), []),
    slice: useCallback((id: string, progress: number) => dispatch({ type: 'slice', id, progress }), []),
    release: useCallback((id: string) => dispatch({ type: 'release', id }), []),
    openAll: useCallback(() => dispatch({ type: 'openAll' }), []),
  };
}

export function useUnbox(cart: Cart | null) {
  const [recorded, setRecorded] = useState<ReadonlySet<string> | null>(null);
  const signedIn = cart !== null;

  useEffect(() => {
    if (!signedIn) return;
    const controller = new AbortController(); let timer: ReturnType<typeof setTimeout> | undefined;
    const load = async () => {
      try {
        const response = await ownerFetch('/api/unbox', { signal: controller.signal });
        if (!response.ok) throw new Error(`GET /api/unbox answered ${response.status}`);
        setRecorded(idsOf(unboxStateSchema.parse(await response.json()).opened));
      } catch (error) {
        if (controller.signal.aborted) return;
        console.warn(error);
        timer = setTimeout(load, RETRY_MS);
      }
    };
    void load();
    return () => { controller.abort(); clearTimeout(timer); };
  }, [signedIn]);

  const commit = useCallback(async (ids: string[], signal: AbortSignal) => {
    const response = await ownerFetch('/api/unbox', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ itemIds: ids }), signal });
    if (!response.ok) throw new Error(`POST /api/unbox answered ${response.status}`);
    setRecorded(idsOf(unboxStateSchema.parse(await response.json()).opened));
  }, []);
  const itemIds = useMemo(() => cart?.items.map(item => item.id) ?? null, [cart]);
  return useUnboxFlow(itemIds, recorded, commit);
}
export type UnboxController = ReturnType<typeof useUnboxFlow>;
